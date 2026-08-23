#!/usr/bin/env node

// Per-tier report.
//
// Deliberately cannot produce an overall winner. There is no cross-tier or
// cross-budget aggregate, because on the small tier alone the leader changes at
// every budget: one provider wins at 1k, another at 4k, a third at 16k. Averaging
// those would manufacture a single answer out of a genuine disagreement, and the
// disagreement is the finding.
//
// Every row carries its coverage. Six arms in the first version had one repository
// and six had four, printed identically, which made a hint look like a finding.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import {
  checkControlsLose,
  checkControlsPresent,
  checkRankingComparable,
  coverageOf,
} from './gates.mjs';

const BUDGETS = [
  ['r@1k', 'mean_recall_at_1000_tokens'],
  ['r@4k', 'mean_recall_at_4000_tokens'],
  ['r@16k', 'mean_recall_at_16000_tokens'],
];

// A stored gate verdict describes the run that wrote it, and one run is not necessarily
// one experiment. When each arm is measured in its own process — which is how a
// 42-second-per-query tool is kept from gating twenty-four others — every artifact
// truthfully reports "controls absent", because the controls are in sibling files.
// Trusting the stored verdict stamped "gate failed" on all 25 arms of a run whose
// controls were present and losing. A verifier reading that either rejects sound numbers
// or learns to ignore the gate, and the second is worse. So the gate is recomputed over
// the union of everything loaded, and a stored failure is honoured only when the union
// cannot re-derive a pass.
function unionGatesPass(paths) {
  const providers = new Set();
  const scored = [];
  for (const path of paths) {
    let score;
    try {
      score = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      continue; // Re-read in the main pass, where a bad file fails loudly.
    }
    if (score.superseded_by) continue;
    for (const entry of score.providers ?? []) {
      providers.add(entry.provider_id);
      if (entry.summary) scored.push({ provider_id: entry.provider_id, summary: entry.summary });
    }
  }
  return (
    checkControlsPresent([...providers]).ok && checkControlsLose({ providers: scored }).ok !== false
  );
}

export function loadTiered(paths) {
  const byTier = new Map();
  const unionOk = unionGatesPass(paths);
  for (const path of paths) {
    const score = JSON.parse(readFileSync(path, 'utf8'));
    // A superseded run stays on disk as evidence for a retraction but must not be
    // averaged in. Mixing a pre-fix and post-fix measurement of the same provider
    // produces a number describing neither version.
    if (score.superseded_by) continue;
    const tier = score.tier ?? score.repository?.tier ?? 'untiered';
    const repo = score.repository?.id ?? 'unknown';
    const bucket = byTier.get(tier) ?? new Map();
    for (const entry of score.providers ?? []) {
      const row = bucket.get(entry.provider_id) ?? {
        provider_id: entry.provider_id,
        repos: [],
        tiers: [],
        samples: [],
        outcomes: {},
        gate_failures: [],
      };
      row.repos.push(repo);
      row.tiers.push(tier);
      row.samples.push(entry.summary?.all ?? {});
      for (const [key, value] of Object.entries(entry.outcomes ?? {})) {
        row.outcomes[key] = (row.outcomes[key] ?? 0) + value;
      }
      // Only a genuine failure counts: if the union has its controls and they lose, a
      // per-artifact "controls absent" is an artefact of how the run was split up.
      if (score.gates?.trustworthy === false && !unionOk) row.gate_failures.push(repo);
      bucket.set(entry.provider_id, row);
    }
    byTier.set(tier, bucket);
  }
  return byTier;
}

function mean(values) {
  const usable = values.filter((v) => Number.isFinite(v));
  return usable.length ? usable.reduce((a, b) => a + b, 0) / usable.length : null;
}

// Weighting is a choice that changes the ranking, so it is made explicitly and both
// figures are reported. Per-case treats every case equally, so a repository with 88
// cases outweighs one with 14. Per-repo treats every repository equally, so a small
// corpus counts as much as a large one. Two arms swapped places between the two on
// the private tier, which is the same lesson as budget choice: state the convention
// or the reader cannot tell a finding from an artifact of the averaging.
function weightedByCases(samples, key) {
  const scored = samples.filter((s) => Number.isFinite(s[key]));
  if (scored.length === 0) return null;
  const withCases = scored.filter((s) => Number.isFinite(s.cases) && s.cases > 0);
  const total = withCases.reduce((sum, s) => sum + s.cases, 0);
  // A sample missing its case count must degrade to equal weight, not disappear.
  // Dropping it silently would remove the arm from the table entirely, which is a
  // worse failure than weighting it imprecisely.
  if (!total) return scored.reduce((sum, s) => sum + s[key], 0) / scored.length;
  return withCases.reduce((sum, s) => sum + s[key] * s.cases, 0) / total;
}

export function summariseTier(bucket) {
  return [...bucket.values()]
    .map((row) => {
      const scores = {};
      const scoresPerRepo = {};
      for (const [label, key] of BUDGETS) {
        // Per-case is primary: a "251 cases" claim implies each case counted once.
        scores[label] = weightedByCases(row.samples, key);
        scoresPerRepo[label] = mean(row.samples.map((s) => s[key]));
      }
      const tokens = mean(row.samples.map((s) => s.median_tokens_delivered));
      const answered = row.outcomes.answered ?? 0;
      const total = Object.values(row.outcomes).reduce((a, b) => a + b, 0);
      const cases = row.samples.reduce((sum, sample) => sum + (sample.cases ?? 0), 0);
      return {
        ...row,
        cases,
        scores,
        scores_per_repo: scoresPerRepo,
        tokens,
        // Answer rate belongs beside accuracy: a provider that silently declines a
        // fifth of queries is not comparable to one that answers all of them.
        answer_rate: total ? answered / total : null,
        coverage: coverageOf(row),
      };
    })
    .sort((a, b) => (b.scores['r@4k'] ?? -1) - (a.scores['r@4k'] ?? -1));
}

export function renderTier(tierId, rows) {
  const pct = (v) => (v === null || v === undefined ? 'n/a' : `${(v * 100).toFixed(1)}%`);
  const out = [`### Tier: ${tierId}`, ''];
  out.push(
    'Weighted per case (each case counts once). Per-repo means differ where corpora differ in size.',
    ''
  );
  out.push('| Provider | r@1k | r@4k | r@16k | tokens | answered | coverage | trust |');
  out.push('| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |');
  for (const row of rows) {
    const trust = row.gate_failures.length
      ? `⚠ gate failed (${row.gate_failures.join(',')})`
      : 'ok';
    const strength =
      row.coverage.strength === 'single-repo' ? `${row.coverage.label} ⚠` : row.coverage.label;
    out.push(
      `| ${row.provider_id} | ${pct(row.scores['r@1k'])} | ${pct(row.scores['r@4k'])} | ${pct(row.scores['r@16k'])} | ${row.tokens === null ? 'n/a' : Math.round(row.tokens).toLocaleString('en-US')} | ${pct(row.answer_rate)} | ${strength} | ${trust} |`
    );
  }
  return out.join('\n');
}

export function render(byTier, { planHash } = {}) {
  const sections = [];
  if (planHash) sections.push(`Pre-registered plan: \`${planHash}\``, '');
  sections.push(
    'No overall winner is computed. Rankings differ by tier and by budget; that is the result.',
    ''
  );
  // Stable tier order regardless of which files were passed in.
  const order = ['small', 'medium', 'large', 'untiered'];
  for (const tier of order) {
    const bucket = byTier.get(tier);
    if (!bucket) continue;
    sections.push(renderTier(tier, summariseTier(bucket)), '');
  }
  const perTierLeaders = [];
  for (const tier of order) {
    const bucket = byTier.get(tier);
    if (!bucket) continue;
    for (const [label] of BUDGETS) {
      const rows = summariseTier(bucket).filter((r) => r.scores[label] !== null);
      if (!rows.length) continue;
      const best = rows.reduce((a, b) => (b.scores[label] > a.scores[label] ? b : a));
      perTierLeaders.push(
        `- **${tier} @ ${label}**: ${best.provider_id} (${(best.scores[label] * 100).toFixed(1)}%)`
      );
    }
  }
  if (perTierLeaders.length) {
    sections.push('#### Leader by tier and budget', '', ...perTierLeaders, '');
  }
  // Stated before anyone reads the leaders: a ranking is only as defensible as the
  // thinnest arm in it.
  const comparability = [];
  for (const tier of order) {
    const bucket = byTier.get(tier);
    if (!bucket) continue;
    const check = checkRankingComparable(summariseTier(bucket));
    if (!check.ok) comparability.push(`- **${tier}**: ${check.reason}`);
  }
  if (comparability.length) {
    sections.push(
      '#### ⚠ Ranking comparability',
      '',
      'These rankings mix evidence of different strengths. Treat single-repository rows as hints.',
      '',
      ...comparability,
      ''
    );
  }
  return sections.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const paths = [];
  let planHash;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--score') paths.push(args[(i += 1)]);
    else if (args[i] === '--plan-hash') planHash = args[(i += 1)];
    else throw new Error(`unknown argument: ${args[i]}`);
  }
  process.stdout.write(`${render(loadTiered(paths), { planHash })}\n`);
}
