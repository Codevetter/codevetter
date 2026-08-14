import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

import {
  LOCAL_SERVER_ATTESTATION_SCHEMA_VERSION,
  QUALIFIED_LOCAL_SERVER_ATTESTATION_SCHEMA_VERSION,
  assertLocalServerAttestation,
  assertQualifiedLocalServerAttestation,
} from './local-server-attestation-contracts.mjs';
import {
  assertLoopbackBaseUrl,
  playwrightCandidateSafetyAllowsCapture,
  qualifiedPlaywrightDeclarationLine,
} from './playwright-capture-contracts.mjs';
import { qualifyRepository } from './qualification.mjs';
import { minimalEnvironment } from './runner.mjs';

const execFileAsync = promisify(execFile);
const MAX_LISTENERS = 8;
const MAX_ANCESTORS = 12;
const TOOL_TIMEOUT_MS = 1_000;
const TOOL_OUTPUT_BYTES = 64 * 1024;

export async function attestQualifiedLocalServer(
  { repositoryRoot, candidateId },
  { qualify = qualifyRepository, attest = attestDeclaredLocalServer } = {}
) {
  const root = await realpath(resolve(repositoryRoot));
  const qualification = await qualify(root);
  const candidate = (qualification.flows ?? []).find((flow) => flow.id === candidateId);
  const baseUrl = candidateBaseUrl(candidate);
  if (
    !candidate ||
    !playwrightCandidateSafetyAllowsCapture(candidate) ||
    !candidate.name ||
    !baseUrl ||
    qualifiedPlaywrightDeclarationLine(candidate) === null
  ) {
    throw new Error('candidate is not an exact statically qualified local Playwright flow');
  }
  const result = await attest({ repositoryRoot: root, baseUrl, candidate });
  return assertQualifiedLocalServerAttestation({
    schema_version: QUALIFIED_LOCAL_SERVER_ATTESTATION_SCHEMA_VERSION,
    subject: qualification.subject,
    scope: {
      candidate_id: candidate.id,
      target: candidate.target,
      name: candidate.name,
      base_url: baseUrl,
    },
    attestation: result,
    limitations: [
      'Attestation is read-only and does not start, stop, or prove production equivalence of the local server.',
    ],
  });
}

export async function attestDeclaredLocalServer({
  repositoryRoot,
  baseUrl,
  candidate,
  inspect = inspectLocalListenerProcesses,
}) {
  const root = await realpath(resolve(repositoryRoot));
  const url = new URL(assertLoopbackBaseUrl(baseUrl));
  const port = url.port ? Number(url.port) : 80;
  const expectation = declaredServerExpectation(candidate);
  if (!expectation) {
    return attestation({
      state: 'expected_family_unavailable',
      expectation: null,
      checks: emptyChecks(),
      limitations: [
        'Static qualification did not establish one expected server family for this origin.',
      ],
    });
  }

  let inventory;
  try {
    inventory = await inspect({ port });
  } catch {
    return attestation({
      state: 'inspection_unavailable',
      expectation,
      checks: emptyChecks(),
      limitations: ['Local listener process inspection was unavailable or exceeded its bound.'],
    });
  }
  if (inventory.status !== 'ok') {
    return attestation({
      state: 'inspection_unavailable',
      expectation,
      checks: emptyChecks(),
      limitations: ['Local listener process inspection is unsupported or unavailable.'],
    });
  }
  const listeners = inventory.listeners.slice(0, MAX_LISTENERS);
  if (listeners.length === 0) {
    return attestation({
      state: 'not_listening',
      expectation,
      checks: emptyChecks(),
      limitations: ['No bounded local listener process was observed on the declared port.'],
    });
  }
  const normalized = await Promise.all(
    listeners.map(async (listener) => ({
      repository: await containsRepositoryCwd(root, listener.working_directories ?? []),
      family: matchesFamily(expectation.family, listener.commands ?? []),
    }))
  );
  const repositoryMatch = normalized.some((entry) => entry.repository);
  const familyMatch = normalized.some((entry) => entry.family);
  const matching = normalized.filter((entry) => entry.repository && entry.family).length;
  const checks = {
    listener_count: listeners.length,
    repository_cwd_match: repositoryMatch,
    declared_family_match: familyMatch,
  };
  if (listeners.length === 1 && matching === 1) {
    return attestation({
      state: 'verified_by_declared_process',
      expectation,
      checks,
      limitations: [
        'Local process attestation proves repository ownership and declared server family, not production equivalence.',
      ],
    });
  }
  return attestation({
    state: 'listener_mismatch',
    expectation,
    checks,
    limitations: [
      'The declared port listener was ambiguous, outside the repository, or a different server family.',
    ],
  });
}

export function declaredServerExpectation(candidate) {
  const families = (candidate?.signals ?? []).filter(
    (signal) => signal.kind === 'declared_browser_server_family'
  );
  const digests = (candidate?.signals ?? []).filter(
    (signal) => signal.kind === 'declared_browser_server_command_sha256'
  );
  if (
    families.length !== 1 ||
    !['wrangler', 'vite', 'next', 'node'].includes(families[0].evidence) ||
    digests.length !== 1 ||
    !/^[0-9a-f]{64}$/.test(digests[0].evidence ?? '')
  ) {
    return null;
  }
  return { family: families[0].evidence, command_sha256: digests[0].evidence };
}

function candidateBaseUrl(candidate) {
  const values = (candidate?.signals ?? []).filter(
    (signal) => signal.kind === 'loopback_browser_base_url'
  );
  if (values.length !== 1) return null;
  try {
    return assertLoopbackBaseUrl(values[0].evidence);
  } catch {
    return null;
  }
}

export function unavailableLocalServerAttestation(candidate) {
  const expectation = declaredServerExpectation(candidate);
  return attestation({
    state: expectation ? 'inspection_unavailable' : 'expected_family_unavailable',
    expectation,
    checks: emptyChecks(),
    limitations: [
      expectation
        ? 'Local listener process inspection was unavailable.'
        : 'Static qualification did not establish one expected server family for this origin.',
    ],
  });
}

export async function inspectLocalListenerProcesses({ port }) {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('listener port is invalid');
  }
  let stdout;
  try {
    ({ stdout } = await runTool('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp']));
  } catch (error) {
    if (error?.code === 1 && !error?.stdout) return { status: 'ok', listeners: [] };
    return { status: 'unavailable', listeners: [] };
  }
  const pids = [
    ...new Set(
      stdout
        .split(/\r?\n/)
        .filter((line) => /^p\d+$/.test(line))
        .map((line) => line.slice(1))
    ),
  ].slice(0, MAX_LISTENERS);
  const listeners = [];
  for (const pid of pids) {
    const process = await inspectProcessAncestry(pid);
    if (process) listeners.push(process);
  }
  return { status: 'ok', listeners };
}

async function inspectProcessAncestry(initialPid) {
  const workingDirectories = [];
  const commands = [];
  const seen = new Set();
  let pid = initialPid;
  for (let depth = 0; depth < MAX_ANCESTORS && /^\d+$/.test(pid) && pid !== '0'; depth += 1) {
    if (seen.has(pid)) break;
    seen.add(pid);
    try {
      const cwd = await runTool('lsof', ['-a', '-p', pid, '-d', 'cwd', '-Fn']);
      const path = cwd.stdout
        .split(/\r?\n/)
        .find((line) => line.startsWith('n'))
        ?.slice(1);
      if (path) workingDirectories.push(path);
    } catch {
      // A short-lived ancestor can disappear between bounded inspection calls.
    }
    let process;
    try {
      process = await runTool('ps', ['-o', 'ppid=', '-o', 'command=', '-p', pid]);
    } catch {
      break;
    }
    const line = process.stdout.trim();
    const match = line.match(/^(\d+)\s+([\s\S]+)$/);
    if (!match) break;
    commands.push(match[2]);
    pid = match[1];
  }
  return { working_directories: workingDirectories, commands };
}

async function runTool(program, args) {
  return execFileAsync(program, args, {
    shell: false,
    timeout: TOOL_TIMEOUT_MS,
    maxBuffer: TOOL_OUTPUT_BYTES,
    env: minimalEnvironment(),
    encoding: 'utf8',
  });
}

async function containsRepositoryCwd(root, paths) {
  for (const path of paths.slice(0, MAX_ANCESTORS)) {
    let candidate;
    try {
      candidate = await realpath(resolve(path));
    } catch {
      continue;
    }
    const pathFromRoot = relative(root, candidate);
    if (
      pathFromRoot === '' ||
      (pathFromRoot !== '..' &&
        !pathFromRoot.startsWith(`..${sep}`) &&
        !pathFromRoot.startsWith(sep))
    ) {
      return true;
    }
  }
  return false;
}

function matchesFamily(family, commands) {
  const source = commands.slice(0, MAX_ANCESTORS).join('\n').toLowerCase();
  if (family === 'wrangler') return /\bwrangler\b[^\n]*\bdev\b|\bworkerd\b/.test(source);
  if (family === 'vite') {
    return (
      /(?:^|[\s/])vite(?:\.js)?(?:\s|$)|vite\/bin\/vite/.test(source) ||
      source.includes('--codevetter-server-family=vite')
    );
  }
  if (family === 'next') {
    return (
      /\bnext\s+(?:dev|start)\b|\bnext-server\b/.test(source) ||
      source.includes('--codevetter-server-family=next')
    );
  }
  if (family === 'node') return /(?:^|[\s/])node(?:\s|$)/.test(source);
  return false;
}

function attestation({ state, expectation, checks, limitations }) {
  return assertLocalServerAttestation({
    schema_version: LOCAL_SERVER_ATTESTATION_SCHEMA_VERSION,
    state,
    expected_family: expectation?.family ?? null,
    declared_command_sha256: expectation?.command_sha256 ?? null,
    checks,
    limitations,
  });
}

function emptyChecks() {
  return { listener_count: 0, repository_cwd_match: false, declared_family_match: false };
}
