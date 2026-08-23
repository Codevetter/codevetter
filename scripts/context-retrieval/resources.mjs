#!/usr/bin/env node

// Resource accounting for provider runs.
//
// Footprint is a first-class result, not overhead. A provider that needs gigabytes
// of RAM or a multi-gigabyte install is unusable in CI or on a laptop beside an IDE,
// however good its recall — and an unmeasured footprint is how a benchmark run
// surprises the machine it is running on.

import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SAMPLE_INTERVAL_MS = 250;

// The sampler MUST live in its own process. Adapters shell out with execFileSync,
// which blocks this event loop for the whole subprocess lifetime, so an in-process
// setInterval never fires while a provider is actually working — it reports the
// baseline forever and every delta comes out zero.
export function createResourceMonitor({ intervalMs = SAMPLE_INTERVAL_MS } = {}) {
  const baseline = processTreeRssKb();
  const samplePath = join(tmpdir(), `codevetter-rss-${process.pid}-${baseline}.txt`);
  const seconds = Math.max(0.05, intervalMs / 1000);
  const child = spawn(
    '/bin/sh',
    [
      '-c',
      // Total RSS of every process on the box, sampled independently of this Node
      // process. Coarse, but it cannot be starved by our blocking calls.
      `while :; do ps -Ao rss= | awk '{s+=$1} END {print s}' >> "${samplePath}"; sleep ${seconds}; done`,
    ],
    { stdio: 'ignore', detached: false }
  );

  return {
    stop() {
      child.kill('SIGKILL');
      let peakKb = baseline;
      try {
        for (const line of readFileSync(samplePath, 'utf8').split('\n')) {
          const value = Number.parseInt(line.trim(), 10);
          if (Number.isFinite(value) && value > peakKb) peakKb = value;
        }
      } catch {
        // No samples captured; fall back to the baseline rather than inventing one.
      }
      rmSync(samplePath, { force: true });
      return {
        baseline_rss_mb: round(baseline / 1024),
        peak_rss_mb: round(peakKb / 1024),
        // System-wide, so treat as an upper bound on what this provider added.
        delta_rss_mb: round(Math.max(0, peakKb - baseline) / 1024),
        scope: 'system-wide-upper-bound',
      };
    },
  };
}

// System-wide resident total, matching the sampler's scope so baseline and peak are
// the same measurement. A provider's worker pool and model load are then counted
// rather than hidden behind a subprocess boundary — at the cost of also counting
// unrelated system activity, hence the upper-bound label.
function processTreeRssKb() {
  try {
    const output = execFileSync('/bin/sh', ['-c', "ps -Ao rss= | awk '{s+=$1} END {print s}'"], {
      encoding: 'utf8',
    });
    const total = Number.parseInt(output.trim(), 10);
    return Number.isFinite(total) ? total : 0;
  } catch {
    return 0;
  }
}

// Exact peak RSS of one command, including children it forks. Preferred over the
// sampler for per-provider comparison: no background noise and no dependence on our
// event loop. The sampler stays for whole-run accounting only — a system-wide delta
// cannot tell a provider's worker pool from an unrelated browser tab.
export function peakRssMbOf(command, args, options = {}) {
  if (process.platform !== 'darwin') return { stdout: null, peak_rss_mb: null };
  // `time -l` reports on stderr, and execFileSync returns stdout, so the report has
  // to be swapped onto stdout: `2>&1 >/dev/null` duplicates stderr to the pipe first,
  // then sends the command's own stdout to /dev/null.
  const script = `{ /usr/bin/time -l ${[command, ...args].map(shellQuote).join(' ')} ; } 2>&1 >/dev/null`;
  try {
    return parseTimed(execFileSync('/bin/sh', ['-c', script], { encoding: 'utf8', ...options }));
  } catch (error) {
    return parseTimed(`${error?.stdout ?? ''}${error?.stderr ?? ''}`);
  }
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

function parseTimed(text) {
  const match = /(\d+)\s+maximum resident set size/.exec(text);
  return {
    peak_rss_mb: match ? round(Number.parseInt(match[1], 10) / 1048576) : null,
  };
}

export function directoryBytes(path) {
  try {
    const output = execFileSync('du', ['-sk', path], { encoding: 'utf8' });
    return Number.parseInt(output.trim().split(/\s+/)[0], 10) * 1024;
  } catch {
    return 0;
  }
}

function round(value) {
  return Math.round(value * 10) / 10;
}
