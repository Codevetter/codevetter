#!/usr/bin/env node

// Consolidates score artifacts into one publishable table.
//
// Reads whatever score files it is given, aligns providers across them, and prints
// per-repository rows plus a pooled summary. Availability and phantom rate sit
// beside accuracy on purpose: accuracy alone ranked a tool first that silently
// refused one query in five and returned deleted files nearly every time.

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

export function loadScores(paths) {
  return paths.map((path) => {
    const score = JSON.parse(readFileSync(path, 'utf8'));
    return { repo: score.repository?.id ?? basename(path), score };
  });
}

export function loadStaleness(paths) {
  const phantom = new Map();
  for (const path of paths) {
    let report;
    try {
      report = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      continue;
    }
    for (const provider of report.providers ?? []) {
      const bucket = phantom.get(provider.provider_id) ?? { phantoms: 0, scored: 0 };
      bucket.phantoms += provider.outcomes?.['served-phantom'] ?? 0;
      bucket.scored += provider.scored ?? 0;
      phantom.set(provider.provider_id, bucket);
    }
  }
  return phantom;
}

export function buildTable({ scores, phantom }) {
  const providers = new Map();
  for (const { repo, score } of scores) {
    for (const entry of score.providers) {
      const row = providers.get(entry.provider_id) ?? {
        provider_id: entry.provider_id,
        repos: {},
        fails: 0,
        cases: 0,
      };
      const all = entry.summary.all;
      row.repos[repo] = {
        r1k: all.mean_recall_at_1000_tokens,
        r4k: all.mean_recall_at_4000_tokens,
        r16k: all.mean_recall_at_16000_tokens,
        r10: all.mean_recall_at_10,
        tokens: all.median_tokens_delivered,
        latency: all.median_latency_ms,
      };
      row.fails += all.unavailable;
      row.cases += all.cases;
      providers.set(entry.provider_id, row);
    }
  }
  // Ranked by the 4k budget: the tightest budget where every arm returns something.
  return [...providers.values()]
    .map((row) => {
      const repos = Object.values(row.repos);
      const mean = (pick) =>
        repos.length === 0 ? 0 : repos.reduce((sum, r) => sum + pick(r), 0) / repos.length;
      return {
        ...row,
        mean_r1k: mean((r) => r.r1k),
        mean_r4k: mean((r) => r.r4k),
        mean_r16k: mean((r) => r.r16k),
        mean_r10: mean((r) => r.r10),
        median_tokens: median(repos.map((r) => r.tokens)),
        median_latency: median(repos.map((r) => r.latency)),
        fail_rate: row.cases > 0 ? row.fails / row.cases : null,
        phantom_rate: rate(phantom.get(row.provider_id)),
      };
    })
    .sort((left, right) => right.mean_r4k - left.mean_r4k);
}

export function renderMarkdown(table, repoNames) {
  const pct = (value) =>
    value === null || value === undefined ? 'n/a' : `${(value * 100).toFixed(1)}%`;
  const lines = [
    `| Provider | r@1k | r@4k | r@16k | r@10 | tokens | p50 ms | fails | phantom |`,
    `| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |`,
  ];
  for (const row of table) {
    lines.push(
      `| ${row.provider_id} | ${pct(row.mean_r1k)} | ${pct(row.mean_r4k)} | ${pct(row.mean_r16k)} | ${pct(row.mean_r10)} | ${Math.round(row.median_tokens).toLocaleString('en-US')} | ${Math.round(row.median_latency)} | ${pct(row.fail_rate)} | ${pct(row.phantom_rate)} |`
    );
  }
  return `Repositories: ${repoNames.join(', ')}\n\n${lines.join('\n')}\n`;
}

function median(values) {
  const usable = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (usable.length === 0) return 0;
  const middle = Math.floor(usable.length / 2);
  return usable.length % 2 === 0 ? (usable[middle - 1] + usable[middle]) / 2 : usable[middle];
}

function rate(bucket) {
  if (!bucket || bucket.scored === 0) return null;
  return bucket.phantoms / bucket.scored;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const scorePaths = [];
  const stalenessPaths = [];
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--score') scorePaths.push(args[(index += 1)]);
    else if (args[index] === '--staleness') stalenessPaths.push(args[(index += 1)]);
    else throw new Error(`unknown argument: ${args[index]}`);
  }
  const scores = loadScores(scorePaths);
  const table = buildTable({ scores, phantom: loadStaleness(stalenessPaths) });
  process.stdout.write(
    renderMarkdown(
      table,
      scores.map((entry) => entry.repo)
    )
  );
}
