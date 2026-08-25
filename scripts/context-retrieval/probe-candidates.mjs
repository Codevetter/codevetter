#!/usr/bin/env node

// Capability probe over the candidate registry.
//
// Hand-integrating twenty tools before knowing which ones even run is the wrong
// order — of the first four attempted, two were broken on install. This probe
// establishes eligibility cheaply and uniformly, and its exclusion reasons are
// themselves a publishable result about the state of the category.
//
// Publication requirements this enforces:
//   - every candidate is reported, including failures, so nothing is quietly dropped
//   - the installed version is captured at probe time, not taken from the registry
//   - environment identity is recorded alongside results so numbers stay traceable
//   - candidates run STRICTLY sequentially behind a memory guard, because several
//     load embedding models and the machine has already been pushed once

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PROBE_SCHEMA_VERSION = 'codevetter.context-retrieval-probe.v1';

// Refuse to start another candidate below this much free memory. A probe that
// crashes the host produces no result and costs the operator their session.
const MIN_FREE_MEMORY_MB = 2048;
const NOT_RUNNABLE = new Set(['blocked-egress', 'excluded-inapplicable', 'excluded-stale']);
// Unknown tiers must sort last, not first: indexOf returns -1 for them.
const TIER_ORDER = ['light', 'heavy', 'hosted'];

export function environmentIdentity() {
  const read = (command, args) => {
    try {
      return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
        .trim()
        .split('\n')[0];
    } catch {
      return null;
    }
  };
  return {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    cpu: read('sysctl', ['-n', 'machdep.cpu.brand_string']),
    total_memory_mb: Math.round(Number(read('sysctl', ['-n', 'hw.memsize']) ?? 0) / 1048576),
    git: read('git', ['--version']),
    uv: read('uv', ['--version']),
    cargo: read('cargo', ['--version']),
    docker: read('docker', ['--version']),
  };
}

export function freeMemoryMb({ exec = execFileSync } = {}) {
  try {
    const pageSize = Number(exec('sysctl', ['-n', 'hw.pagesize'], { encoding: 'utf8' }).trim());
    const stats = exec('vm_stat', { encoding: 'utf8' });
    const grab = (label) => {
      const match = new RegExp(`${label}:\\s+(\\d+)`).exec(stats);
      return match ? Number(match[1]) : 0;
    };
    // Free + speculative + inactive + purgeable. The first three alone read 4.4 GB on
    // a 48 GB machine that `memory_pressure` simultaneously called 71% free, because
    // macOS parks most reclaimable memory outside those buckets — which had this guard
    // primed to abort perfectly healthy runs.
    const pages =
      grab('Pages free') +
      grab('Pages speculative') +
      grab('Pages inactive') +
      grab('Pages purgeable');
    const fromPages = Math.round((pages * pageSize) / 1048576);
    // Cross-check against the kernel's own view and take the larger. `memory_pressure`
    // is the number Activity Monitor agrees with; page arithmetic is the pessimist.
    return Math.max(fromPages, pressureFreeMb(exec) ?? 0);
  } catch {
    return null;
  }
}

// The kernel's own free-percentage line, converted to MB. Returns 0 rather than
// throwing when unavailable, so the page-arithmetic path stays authoritative there.
function pressureFreeMb(exec) {
  try {
    const out = exec('memory_pressure', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const percent = /free percentage:\s*(\d+)%/i.exec(out);
    if (!percent) return null;
    const total = Number(exec('sysctl', ['-n', 'hw.memsize'], { encoding: 'utf8' }).trim());
    return Math.round((total * Number(percent[1])) / 100 / 1048576);
  } catch {
    return null;
  }
}

export function loadCandidates(path) {
  const registry = JSON.parse(readFileSync(path, 'utf8'));
  if (registry.schema_version !== 'codevetter.context-retrieval-candidates.v1') {
    throw new Error(`unexpected candidate registry version: ${registry.schema_version}`);
  }
  return registry;
}

export function orderCandidates(candidates) {
  // Light tiers first so cheap results land before anything risks the machine;
  // within a tier, priority then stars, so the most informative go first.
  return [...candidates].sort((left, right) => {
    const rank = (tier) => {
      const index = TIER_ORDER.indexOf(tier);
      return index === -1 ? TIER_ORDER.length : index;
    };
    const tier = rank(left.tier) - rank(right.tier);
    if (tier !== 0) return tier;
    const priority = (left.priority ?? 99) - (right.priority ?? 99);
    if (priority !== 0) return priority;
    return (right.stars ?? 0) - (left.stars ?? 0);
  });
}

export function planProbes({ registry, only = [], skipMeasured = true }) {
  const selected = registry.candidates.filter((candidate) => {
    if (only.length > 0) return only.includes(candidate.id);
    // Recorded but not runnable: kept in the registry for transparency, excluded
    // from the run plan so the plan reflects what will actually execute.
    if (NOT_RUNNABLE.has(candidate.status)) return false;
    if (skipMeasured && candidate.status === 'measured') return false;
    return true;
  });
  return orderCandidates(selected);
}

export function summarizeRegistry(registry) {
  const byStatus = new Map();
  const byTier = new Map();
  for (const candidate of registry.candidates) {
    byStatus.set(candidate.status, (byStatus.get(candidate.status) ?? 0) + 1);
    byTier.set(candidate.tier, (byTier.get(candidate.tier) ?? 0) + 1);
  }
  return {
    total: registry.candidates.length,
    by_status: Object.fromEntries([...byStatus].sort()),
    by_tier: Object.fromEntries([...byTier].sort()),
    falsifiable_claims: registry.candidates.filter((candidate) => candidate.falsifiable).length,
    requires_service: registry.candidates.filter(
      (candidate) => (candidate.requires ?? []).length > 0
    ).length,
  };
}

export function guardMemory({ minFreeMb = MIN_FREE_MEMORY_MB, freeMemory = freeMemoryMb } = {}) {
  if (minFreeMb <= 0) return { free_mb: null, ok: true, minimum_mb: minFreeMb };
  const free = freeMemory();
  return {
    free_mb: Number.isFinite(free) ? free : null,
    ok: Number.isFinite(free) && free >= minFreeMb,
    minimum_mb: minFreeMb,
  };
}

async function writeJsonAtomic(path, value) {
  const destination = resolve(path);
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, destination);
}

function parseArgs(args) {
  const options = {
    registry: 'benchmarks/context-retrieval/candidates.json',
    only: [],
    out: undefined,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--plan-only') {
      options.planOnly = true;
      continue;
    }
    if (!['--registry', '--only', '--out'].includes(argument)) {
      throw new Error(`unknown argument: ${argument}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
    index += 1;
    if (argument === '--registry') options.registry = value;
    if (argument === '--only') options.only = value.split(',');
    if (argument === '--out') options.out = value;
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const registry = loadCandidates(options.registry);
    const plan = planProbes({ registry, only: options.only });
    const report = {
      schema_version: PROBE_SCHEMA_VERSION,
      surveyed_at: registry.surveyed_at,
      inclusion_rule: registry.inclusion_rule,
      environment: environmentIdentity(),
      memory_guard: guardMemory(),
      registry_summary: summarizeRegistry(registry),
      execution_order: plan.map((candidate) => ({
        id: candidate.id,
        tier: candidate.tier,
        stars: candidate.stars,
        mechanism: candidate.mechanism,
        interface: candidate.interface,
        requires: candidate.requires ?? [],
      })),
    };
    if (options.out) await writeJsonAtomic(options.out, report);
    const guard = report.memory_guard;
    process.stdout.write(
      `Candidates: ${report.registry_summary.total} · falsifiable claims: ${report.registry_summary.falsifiable_claims}\n` +
        `By tier: ${JSON.stringify(report.registry_summary.by_tier)}\n` +
        `By status: ${JSON.stringify(report.registry_summary.by_status)}\n` +
        `Free memory: ${guard.free_mb} MB (minimum ${guard.minimum_mb} MB) — ${guard.ok ? 'ok' : 'BLOCKED'}\n` +
        `Planned order (${plan.length}):\n` +
        plan
          .map(
            (candidate, index) =>
              `  ${String(index + 1).padStart(2)}. [${candidate.tier}] ${candidate.id} (${candidate.stars}*)${
                (candidate.requires ?? []).length > 0
                  ? ` needs ${candidate.requires.join('+')}`
                  : ''
              }`
          )
          .join('\n') +
        '\n'
    );
  } catch (error) {
    process.stderr.write(
      `Probe planning failed: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 2;
  }
}
