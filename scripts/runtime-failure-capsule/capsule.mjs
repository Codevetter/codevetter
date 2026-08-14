import { readFile, realpath, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

import {
  CAPSULE_SCHEMA_VERSION,
  LIMITS,
  isExcludedPath,
  repositoryRelative,
  validateCapsule,
} from './contracts.mjs';
import { detectRuntimeLanes } from './detect.mjs';
import { inspectGitDiff, rankRelevantChanges } from './git-diff.mjs';
import { redactJsonValue, redactText } from './redact.mjs';

export async function capsuleFromExecution({ repositoryRoot, adapter, execution, diffRange }) {
  const lexicalRoot = resolve(repositoryRoot);
  const canonicalRoot = await realpath(lexicalRoot);
  const [git, detection] = await Promise.all([
    inspectGitDiff(canonicalRoot, diffRange),
    detectRuntimeLanes(canonicalRoot),
  ]);
  const sanitized = sanitizeExecution(execution, canonicalRoot, [lexicalRoot]);
  const combined = `${sanitized.stdout.text}\n${sanitized.stderr.text}`;
  const frames = extractSourceFrames(combined, { target: execution.scope.target });
  const relevantChanges = rankRelevantChanges(frames, git.changed_lines).slice(0, LIMITS.changes);
  const selection = ['vitest', 'jest'].includes(adapter)
    ? parseVitestSelection(sanitized.stdout.text)
    : null;
  const selectedNameAppears = !execution.scope.name || combined.includes(execution.scope.name);
  const selectedTestExecuted = selection ? selection.executed_tests > 0 : selectedNameAppears;
  const reproduced =
    execution.status === 'exited' && execution.exitCode !== 0 && selectedTestExecuted;
  const limitations = [];
  if (execution.status === 'timeout') limitations.push('Diagnostic execution timed out.');
  if (execution.status === 'operational_failure') {
    limitations.push(
      `Diagnostic process was unavailable: ${execution.operationalError ?? 'unknown error'}`
    );
  }
  if (selection && selection.executed_tests === 0) {
    limitations.push('The selected Vitest identity matched zero executed tests.');
  } else if (execution.status === 'exited' && execution.exitCode === 0) {
    limitations.push('The selected failure did not reproduce during the diagnostic run.');
  }
  if (!selection && !selectedNameAppears)
    limitations.push('The selected test identity did not appear in runner output.');
  if (frames.length === 0) limitations.push('No repository source frame was captured.');
  if (relevantChanges.length === 0) {
    limitations.push('No captured source frame matched the selected Git diff.');
  }
  if (sanitized.stdout.truncated || sanitized.stderr.truncated || execution.truncated) {
    limitations.push('Runner output was truncated before normalization.');
  }
  const observed = reproduced
    ? [
        {
          id: 'observation-1',
          kind: adapter === 'go-test' ? 'go_test_failure' : 'test_failure',
          summary: failureSummary(combined),
          provenance: 'diagnostic_process_output',
          source_frame_ids: frames.map((frame) => frame.id),
        },
      ]
    : [];
  const capsule = createCapsule({
    git,
    lane: selectLane(adapter, detection),
    adapter: {
      kind: adapter,
      executable_identity: execution.command.executable_identity,
      arguments: execution.command.arguments,
    },
    scope: execution.scope,
    terminal: {
      status: execution.status,
      exit_code: execution.exitCode,
      signal: execution.signal,
      duration_ms: execution.durationMs,
    },
    observed,
    frames,
    relevantChanges,
    limitations,
    verdict: reproduced ? 'failed' : 'no_confidence',
    capture: {
      stdout_bytes: execution.stdoutBytes,
      stderr_bytes: execution.stderrBytes,
      truncated: execution.truncated || sanitized.stdout.truncated || sanitized.stderr.truncated,
      redaction_count: sanitized.stdout.redaction_count + sanitized.stderr.redaction_count,
      coverage: reproduced ? 'failure_output_and_repository_frames' : 'incomplete',
      selection,
    },
  });
  return capsule;
}

export function parseVitestSelection(output) {
  const report = parseVitestReport(output);
  if (!report) return null;
  const total = Number(report?.numTotalTests);
  const pending = Number(report?.numPendingTests ?? 0);
  const todo = Number(report?.numTodoTests ?? 0);
  if (![total, pending, todo].every(Number.isFinite)) return null;
  return {
    total_tests: total,
    executed_tests: Math.max(0, total - pending - todo),
    failed_tests: Number.isFinite(Number(report?.numFailedTests))
      ? Number(report.numFailedTests)
      : null,
  };
}

export function parseVitestReport(output) {
  const text = String(output).trim();
  if (text.length === 0) return null;
  const lineCandidates = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{') && line.endsWith('}'))
    .reverse();
  const candidates =
    text.startsWith('{') && text.endsWith('}')
      ? [text, ...lineCandidates.filter((line) => line !== text)]
      : lineCandidates;
  for (const candidate of candidates.slice(0, LIMITS.observations)) {
    let report;
    try {
      report = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (!report || Array.isArray(report) || typeof report !== 'object') continue;
    const hasCounts = Number.isFinite(Number(report.numTotalTests));
    const hasResults = Array.isArray(report.testResults);
    if (hasCounts || hasResults) return report;
  }
  return null;
}

export async function capsuleFromReceipt({ repositoryRoot, kind, receiptPath, diffRange }) {
  const lexicalRoot = resolve(repositoryRoot);
  const root = await realpath(lexicalRoot);
  const lexicalPath = resolve(root, receiptPath);
  const lexicalReceipt = repositoryRelative(root, lexicalPath);
  if (lexicalReceipt === null) throw new Error('receipt path escapes repository');
  let path;
  try {
    path = await realpath(lexicalPath);
  } catch {
    throw new Error('receipt is not a readable regular file');
  }
  const relativeReceipt = repositoryRelative(root, path);
  if (relativeReceipt === null) throw new Error('receipt path escapes repository');
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size > LIMITS.receiptBytes) {
    throw new Error(
      `receipt must be a regular JSON file no larger than ${LIMITS.receiptBytes} bytes`
    );
  }
  const raw = await readFile(path, 'utf8');
  let receipt;
  try {
    receipt = JSON.parse(raw);
  } catch {
    throw new Error('receipt is not valid JSON');
  }
  const sanitized = redactJsonValue(receipt, {
    repositoryRoot: root,
    repositoryRoots: [lexicalRoot],
    limit: 8_000,
  });
  receipt = sanitized.value;
  const sanitizedText = JSON.stringify(receipt);
  const git = await inspectGitDiff(root, diffRange);
  const status = receiptStatus(receipt);
  const identity = receipt.receipt_id ?? receipt.run_id ?? receipt.id ?? null;
  const complete = typeof identity === 'string' && identity.length > 0 && status !== null;
  const reproduced = complete && ['failed', 'fail', 'failure', 'error'].includes(status);
  const frames = extractSourceFrames(sanitizedText, root);
  const relevantChanges = rankRelevantChanges(frames, git.changed_lines).slice(0, LIMITS.changes);
  const importedLimitations = Array.isArray(receipt.limitations)
    ? receipt.limitations.filter((value) => typeof value === 'string').slice(0, 16)
    : [];
  const limitations = [...importedLimitations];
  if (!complete)
    limitations.push('Imported evidence lacks terminal status or explicit receipt identity.');
  if (status && !reproduced)
    limitations.push(`Imported receipt status "${status}" is not failure proof.`);
  if (frames.length === 0)
    limitations.push('Imported evidence contains no repository source frame.');
  if (relevantChanges.length === 0) {
    limitations.push('No imported source frame matched the selected Git diff.');
  }
  if (sanitized.truncated) limitations.push('Imported receipt was truncated before normalization.');
  const observed = reproduced
    ? [
        {
          id: 'observation-1',
          kind: kind === 'worker' ? 'worker_test_failure' : 'browser_test_failure',
          summary: importedSummary(receipt, kind, status),
          provenance: `receipt:${identity}`,
          source_frame_ids: frames.map((frame) => frame.id),
        },
      ]
    : [];
  return createCapsule({
    git,
    lane: { kind, evidence: [relativeReceipt] },
    adapter: { kind: `${kind}-receipt`, executable_identity: 'imported', arguments: [] },
    scope: { target: relativeReceipt, name: null },
    terminal: { status: 'imported', imported_status: status, receipt_identity: identity },
    observed,
    frames,
    relevantChanges,
    limitations,
    verdict: reproduced ? 'failed' : 'no_confidence',
    capture: {
      receipt_bytes: Buffer.byteLength(raw),
      truncated: sanitized.truncated,
      redaction_count: sanitized.redaction_count,
      coverage: complete ? 'imported_receipt' : 'incomplete',
    },
  });
}

function createCapsule({
  git,
  lane,
  adapter,
  scope,
  terminal,
  observed,
  frames,
  relevantChanges,
  limitations,
  verdict,
  capture,
}) {
  const relationships = relevantChanges.map((change, index) => ({
    id: `relationship-${index + 1}`,
    kind: 'frame_to_diff',
    observation_id: observed[0]?.id ?? null,
    source_frame_id: frames.find(
      (frame) => frame.file === change.file && frame.line === change.frame_line
    )?.id,
    change: {
      file: change.file,
      line: change.line,
      reason: change.reason,
      distance: change.distance,
    },
  }));
  const unverified = relevantChanges.slice(0, 1).map((change) => ({
    kind: 'cause_hypothesis',
    summary: `${change.file}:${change.line} is the highest-ranked changed location on the captured path.`,
    confidence: 'unverified',
    verification_required: 'Patch the candidate and rerun the original verification.',
  }));
  const capsule = {
    schema_version: CAPSULE_SCHEMA_VERSION,
    subject: {
      repository_revision: git.repository_revision,
      diff_identity: git.diff_identity,
      dirty: git.dirty,
    },
    lane,
    adapter,
    scope,
    terminal,
    observed: observed.slice(0, LIMITS.observations),
    source_frames: frames.slice(0, LIMITS.frames),
    relationships,
    relevant_changes: relevantChanges,
    inferred: [],
    unverified,
    limitations: [...new Set(limitations)],
    capture,
    verdict: {
      status: verdict,
      authority: 'exact_diagnostic_scope_only',
    },
  };
  const errors = validateCapsule(capsule);
  if (errors.length > 0) throw new Error(`invalid capsule: ${errors.join('; ')}`);
  return capsule;
}

function selectLane(adapter, detection) {
  const preferred =
    adapter === 'vitest' && detection.lanes.some((lane) => lane.kind === 'cloudflare-worker')
      ? 'cloudflare-worker'
      : adapter === 'playwright'
        ? 'browser'
        : adapter;
  const detected = detection.lanes.find((lane) => lane.kind === preferred);
  return detected
    ? { kind: detected.kind, evidence: detected.evidence }
    : {
        kind: preferred,
        evidence: [],
        limitation: 'Lane was selected explicitly but not detected.',
      };
}

function sanitizeExecution(execution, repositoryRoot, repositoryRoots) {
  const options = {
    repositoryRoot,
    repositoryRoots,
    environmentValues: execution.environmentValues,
  };
  return {
    stdout: redactText(execution.stdout, options),
    stderr: redactText(execution.stderr, options),
  };
}

export function extractSourceFrames(input, { target } = {}) {
  const frames = [];
  const pattern = /<repo>[\\/]([^<>\r\n():]+?\.(?:[cm]?[jt]sx?|go)):(\d+)(?::(\d+))?/g;
  for (const match of String(input).matchAll(pattern)) {
    const file = match[1].replaceAll('\\', '/');
    if (isExcludedPath(file)) continue;
    const frame = { file, line: Number(match[2]), column: match[3] ? Number(match[3]) : null };
    if (frames.some((other) => other.file === frame.file && other.line === frame.line)) continue;
    frames.push({ id: `frame-${frames.length + 1}`, ...frame });
    if (frames.length >= LIMITS.frames) break;
  }
  if (typeof target === 'string' && frames.length < LIMITS.frames) {
    const targetName = basename(target);
    const relativePattern = new RegExp(`${escapeRegExp(targetName)}:(\\d+)`, 'g');
    for (const match of String(input).matchAll(relativePattern)) {
      const line = Number(match[1]);
      if (frames.some((frame) => frame.file === target && frame.line === line)) continue;
      frames.push({ id: `frame-${frames.length + 1}`, file: target, line, column: null });
      if (frames.length >= LIMITS.frames) break;
    }
  }
  return frames;
}

function failureSummary(output) {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const useful = lines.filter((line) =>
    /(?:error|panic|fail|not ok|expected|received|assert|\bgot\b|\bwant\b)/i.test(line)
  );
  return (useful.length > 0 ? useful : lines).slice(0, 12).join('\n').slice(0, 2_000);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function receiptStatus(receipt) {
  const candidate =
    receipt?.verdict?.status ??
    receipt?.verdict ??
    receipt?.terminal?.status ??
    receipt?.result?.status ??
    receipt?.status ??
    receipt?.outcome;
  return typeof candidate === 'string' ? candidate.toLowerCase() : null;
}

function importedSummary(receipt, kind, status) {
  const candidate = receipt?.failure?.message ?? receipt?.error?.message ?? receipt?.message;
  const summary = typeof candidate === 'string' ? candidate : `${kind} receipt reported ${status}`;
  return summary.slice(0, 2_000);
}
