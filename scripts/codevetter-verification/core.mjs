import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { resolve as resolvePath } from 'node:path';

export const SCHEMA_VERSION = '1.0.0';
const MAX_PATHS = 2_000;
const MAX_LANES = 64;
const MAX_OUTPUT_BYTES = 256 * 1024;
const SECRET = /((?:api[_-]?key|token|authorization|password|secret)\s*[:=]\s*)([^\s,;]+)/gi;

export async function loadConfig(url = new URL('./config.json', import.meta.url)) {
  const config = JSON.parse(await readFile(url, 'utf8'));
  if (config.schemaVersion !== SCHEMA_VERSION) throw new Error('Unsupported verification config');
  return config;
}

export function redactText(value, maxBytes = MAX_OUTPUT_BYTES) {
  const redacted = String(value).replace(SECRET, '$1[REDACTED]');
  return Buffer.from(redacted).subarray(0, maxBytes).toString('utf8');
}

export function validatePlan(plan) {
  const issues = [];
  if (!plan || typeof plan !== 'object') return ['plan must be an object'];
  if (plan.schemaVersion !== SCHEMA_VERSION) issues.push('unsupported schemaVersion');
  if (!['worktree', 'staged', 'commit', 'range'].includes(plan.change?.mode))
    issues.push('invalid change mode');
  if (!isHash(plan.change?.identity)) issues.push('invalid change identity');
  if (!Array.isArray(plan.change?.paths) || plan.change.paths.length > MAX_PATHS)
    issues.push('invalid changed paths');
  if (!['interactive', 'exhaustive'].includes(plan.profile)) issues.push('invalid profile');
  if (!Array.isArray(plan.lanes) || plan.lanes.length > MAX_LANES) issues.push('invalid lanes');
  const ids = new Set();
  for (const lane of plan.lanes ?? []) {
    if (!lane || typeof lane.id !== 'string' || ids.has(lane.id))
      issues.push('invalid or duplicate lane');
    ids.add(lane?.id);
    if (!Array.isArray(lane?.command) || lane.command.some((part) => typeof part !== 'string'))
      issues.push('invalid lane command');
    if (!validResources(lane?.resources))
      issues.push(`invalid resources for ${lane?.id ?? 'lane'}`);
  }
  if (!Array.isArray(plan.reasons) || !Array.isArray(plan.omissions))
    issues.push('missing explanations');
  return [...new Set(issues)];
}

export function validateReceipt(receipt) {
  const issues = [];
  if (!receipt || typeof receipt !== 'object') return ['receipt must be an object'];
  if (receipt.schemaVersion !== SCHEMA_VERSION) issues.push('unsupported schemaVersion');
  if (!isHash(receipt.planIdentity)) issues.push('invalid planIdentity');
  if (!['passed', 'failed', 'no_confidence', 'cancelled', 'planned'].includes(receipt.verdict))
    issues.push('invalid verdict');
  if (typeof receipt.complete !== 'boolean') issues.push('complete must be boolean');
  if (!Array.isArray(receipt.lanes) || receipt.lanes.length > MAX_LANES)
    issues.push('invalid lane receipts');
  for (const lane of receipt.lanes ?? []) {
    if (!['passed', 'failed', 'cancelled', 'not_run'].includes(lane?.status))
      issues.push('invalid lane status');
    for (const field of ['wallMs', 'queueMs', 'cpuMs', 'peakRssBytes']) {
      if (!(Number.isFinite(lane?.[field]) && lane[field] >= 0)) issues.push(`invalid ${field}`);
    }
    if (Buffer.byteLength(lane?.output ?? '') > MAX_OUTPUT_BYTES)
      issues.push('lane output too large');
  }
  if (receipt.verdict === 'passed' && !receipt.complete)
    issues.push('incomplete receipt cannot pass');
  return [...new Set(issues)];
}

export function planIdentity(plan) {
  const { createdAt: _createdAt, identity: _identity, ...stablePlan } = plan;
  return createHash('sha256').update(stableJson(stablePlan)).digest('hex');
}

export function createPlan({
  config,
  change,
  profile = 'interactive',
  exhaustive = false,
  hints = [],
}) {
  const laneById = new Map(config.lanes.map((lane) => [lane.id, lane]));
  const selected = new Set();
  const reasons = [];
  const omissions = [];
  let fallback = exhaustive;
  for (const changedPath of change.paths) {
    const match = config.rules.find((rule) =>
      rule.patterns.some((pattern) => matchesGlob(pattern, changedPath))
    );
    if (config.sharedPatterns.some((pattern) => matchesGlob(pattern, changedPath))) {
      fallback = true;
      reasons.push({
        kind: 'shared_fallback',
        path: changedPath,
        detail: 'Shared invalidation boundary changed',
      });
    }
    if (!match) {
      fallback = true;
      reasons.push({
        kind: 'unmatched_fallback',
        path: changedPath,
        detail: 'No authoritative lane mapping matched',
      });
    }
    if (match) {
      for (const laneId of match.lanes) selected.add(laneId);
      reasons.push({ kind: 'explicit', path: changedPath, rule: match.id, lanes: match.lanes });
    }
  }
  for (const hint of hints.slice(0, 100)) {
    if (
      hint.state !== 'current' ||
      hint.sourceIdentity !== change.identity ||
      !laneById.has(hint.laneId)
    ) {
      fallback = true;
      reasons.push({
        kind: 'unsafe_hint',
        detail: 'Stale, invalid, or untrusted impact hint widened selection',
      });
      continue;
    }
    selected.add(hint.laneId);
    reasons.push({ kind: 'additive_hint', lane: hint.laneId, source: hint.source });
  }
  if (fallback) for (const laneId of config.fallbackLanes) selected.add(laneId);
  const ordered = config.lanes.filter((lane) => selected.has(lane.id));
  for (const lane of config.lanes) {
    if (!selected.has(lane.id))
      omissions.push({ lane: lane.id, reason: 'No authoritative impact edge selected this lane' });
  }
  const plan = {
    schemaVersion: SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    change,
    profile: exhaustive ? 'exhaustive' : profile,
    focused: !fallback,
    lanes: ordered,
    reasons,
    omissions,
  };
  const issues = validatePlan(plan);
  if (issues.length) throw new Error(`Invalid verification plan: ${issues.join('; ')}`);
  return { ...plan, identity: planIdentity(plan) };
}

export function resolveGitChange(root, options = {}) {
  const mode = options.staged
    ? 'staged'
    : options.commit
      ? 'commit'
      : options.range
        ? 'range'
        : 'worktree';
  if (options.commit && !safeRevision(options.commit)) throw new Error('Invalid commit revision');
  if (options.range && (!safeRevision(options.range) || !options.range.includes('..')))
    throw new Error('Invalid range revision');
  const args =
    mode === 'staged'
      ? ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACDMRTUXB']
      : mode === 'commit'
        ? ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', options.commit]
        : mode === 'range'
          ? ['diff', '--name-only', '-z', '--diff-filter=ACDMRTUXB', options.range, '--']
          : ['diff', 'HEAD', '--name-only', '-z', '--diff-filter=ACDMRTUXB'];
  const names = git(root, args).split('\0').filter(Boolean);
  let untracked = [];
  if (mode === 'worktree') {
    untracked = git(root, ['ls-files', '--others', '--exclude-standard', '-z'])
      .split('\0')
      .filter(Boolean);
    names.push(...untracked);
  }
  const paths = [...new Set(names)].sort();
  if (paths.length > MAX_PATHS || paths.some((entry) => !safePath(entry)))
    throw new Error('Changed path set is invalid or too large');
  const revision =
    mode === 'commit'
      ? git(root, ['rev-parse', options.commit]).trim()
      : mode === 'range'
        ? git(root, ['rev-parse', options.range.split('..').at(-1)]).trim()
        : git(root, ['rev-parse', 'HEAD']).trim();
  let material =
    mode === 'worktree'
      ? git(root, ['diff', '--binary', 'HEAD'])
      : JSON.stringify({ mode, revision, paths });
  for (const relativePath of untracked) {
    const absolutePath = resolvePath(root, relativePath);
    const stat = lstatSync(absolutePath);
    if (!stat.isFile() || stat.size > 16 * 1024 * 1024)
      throw new Error('Untracked verification input is unsupported or too large');
    material += `\0${relativePath}\0${readFileSync(absolutePath).toString('base64')}`;
  }
  const identity = createHash('sha256')
    .update(material)
    .update('\0')
    .update(paths.join('\0'))
    .digest('hex');
  return { mode, revision, identity, paths };
}

export async function schedulePlan(plan, profile, execute, signal) {
  const usage = { running: 0, cpuSlots: 0, memoryMb: 0, browserContexts: 0, originTokens: 0 };
  const exclusive = new Set();
  const results = new Array(plan.lanes.length);
  const pending = plan.lanes.map((lane, index) => ({ lane, index, queuedAt: performance.now() }));
  await new Promise((resolve, reject) => {
    const pump = () => {
      if (signal?.aborted)
        return reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      let started = false;
      for (let i = 0; i < pending.length; i += 1) {
        const item = pending[i];
        if (!fits(item.lane.resources, profile, usage, exclusive)) continue;
        pending.splice(i, 1);
        i -= 1;
        started = true;
        reserve(item.lane.resources, usage, exclusive, 1);
        const queueMs = performance.now() - item.queuedAt;
        Promise.resolve(execute(item.lane, { queueMs, signal }))
          .then(
            (result) => {
              results[item.index] = { ...result, queueMs };
            },
            (error) => {
              results[item.index] = {
                id: item.lane.id,
                status: 'failed',
                wallMs: 0,
                cpuMs: 0,
                peakRssBytes: 0,
                output: redactText(error),
                queueMs,
              };
            }
          )
          .finally(() => {
            reserve(item.lane.resources, usage, exclusive, -1);
            if (pending.length === 0 && usage.running === 0) resolve();
            else pump();
          });
      }
      if (!started && pending.length > 0 && usage.running === 0)
        reject(new Error(`Resource profile cannot fit lane ${pending[0].lane.id}`));
    };
    pump();
  });
  return results;
}

export async function executeLane(lane, { queueMs = 0, signal, cwd, timeoutMs = 300_000 } = {}) {
  const started = performance.now();
  const child = spawn(lane.command[0], lane.command.slice(1), {
    cwd,
    env: { ...process.env, ...lane.environment },
    shell: false,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let peakRssBytes = 0;
  let cpuMs = 0;
  const collect = (chunk) => {
    output = redactText(output + chunk.toString());
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  const sampler = setInterval(() => {
    const sample = sampleProcess(child.pid);
    peakRssBytes = Math.max(peakRssBytes, sample.rssBytes);
    cpuMs = Math.max(cpuMs, sample.cpuMs);
  }, 200);
  const stop = () => terminateOwned(child);
  signal?.addEventListener('abort', stop, { once: true });
  const timeout = setTimeout(stop, timeoutMs);
  const status = await new Promise((resolve) =>
    child.once('exit', (code) =>
      resolve(signal?.aborted ? 'cancelled' : code === 0 ? 'passed' : 'failed')
    )
  );
  clearInterval(sampler);
  clearTimeout(timeout);
  signal?.removeEventListener('abort', stop);
  return {
    id: lane.id,
    status,
    wallMs: performance.now() - started,
    queueMs,
    cpuMs,
    peakRssBytes,
    output,
  };
}

export function createReceipt(plan, lanes, mode = 'executed') {
  const complete = mode === 'planned' || lanes.length === plan.lanes.length;
  const verdict =
    mode === 'planned'
      ? 'planned'
      : lanes.some((lane) => lane.status === 'cancelled')
        ? 'cancelled'
        : !complete
          ? 'no_confidence'
          : lanes.some((lane) => lane.status === 'failed')
            ? 'failed'
            : 'passed';
  const receipt = {
    schemaVersion: SCHEMA_VERSION,
    planIdentity: plan.identity,
    complete,
    verdict,
    lanes,
  };
  const issues = validateReceipt(receipt);
  if (issues.length) throw new Error(`Invalid verification receipt: ${issues.join('; ')}`);
  return receipt;
}

function matchesGlob(pattern, value) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replaceAll('**', '\u0000')
    .replaceAll('*', '[^/]*')
    .replaceAll('\u0000', '.*');
  return new RegExp(`^${escaped}$`).test(value);
}
function safePath(value) {
  return (
    typeof value === 'string' &&
    value.length <= 512 &&
    !value.startsWith('/') &&
    !value.split('/').includes('..') &&
    !value.includes('\0')
  );
}
function safeRevision(value) {
  return (
    typeof value === 'string' &&
    value.length <= 256 &&
    !value.startsWith('-') &&
    /^[A-Za-z0-9_./~^{}@:+-]+$/.test(value)
  );
}
function isHash(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}
function validResources(value) {
  return (
    value &&
    ['cpuSlots', 'memoryMb', 'browserContexts', 'originTokens'].every(
      (key) => Number.isInteger(value[key]) && value[key] >= 0
    )
  );
}
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
function git(root, args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(redactText(result.stderr));
  return result.stdout;
}
function fits(r, p, u, x) {
  return (
    u.running < p.maxConcurrent &&
    u.cpuSlots + r.cpuSlots <= p.cpuSlots &&
    u.memoryMb + r.memoryMb <= p.memoryMb &&
    u.browserContexts + r.browserContexts <= p.browserContexts &&
    u.originTokens + r.originTokens <= p.originTokens &&
    (!r.exclusiveState || !x.has(r.exclusiveState))
  );
}
function reserve(r, u, x, sign) {
  u.running += sign;
  for (const key of ['cpuSlots', 'memoryMb', 'browserContexts', 'originTokens'])
    u[key] += sign * r[key];
  if (r.exclusiveState) sign > 0 ? x.add(r.exclusiveState) : x.delete(r.exclusiveState);
}
function terminateOwned(child) {
  if (child.exitCode !== null) return;
  try {
    process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGTERM');
  } catch {}
}
function sampleProcess(pid) {
  if (!pid || process.platform === 'win32') return { rssBytes: 0, cpuMs: 0 };
  const sample = spawnSync('ps', ['-o', 'rss=,time=', '-p', String(pid)], { encoding: 'utf8' })
    .stdout.trim()
    .split(/\s+/);
  return { rssBytes: (Number(sample[0]) || 0) * 1024, cpuMs: parseCpu(sample[1]) };
}
function parseCpu(value = '') {
  const parts = value.split(':').map(Number);
  if (parts.some(Number.isNaN)) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0) * 1000;
}
