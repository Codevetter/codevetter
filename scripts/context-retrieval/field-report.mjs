// Consolidates the per-arm artifacts of a single-project full-field run into one
// report, and applies the reliability gates ACROSS the merged field.
//
// The gates have to be applied here rather than per artifact. Each arm ran in its own
// score.mjs process so that one 60-minute tool could not gate the other twenty-three,
// and the consequence is that every individual artifact reports "controls absent" —
// the controls are real, they are simply in sibling files. A per-artifact gate reading
// would have been a false alarm, and ignoring the gate because it looked like a false
// alarm is how a real one gets waved through, so it is recomputed on the union instead.
import { readFileSync, readdirSync } from 'node:fs';

import { checkControlsLose, checkControlsPresent, REQUIRED_CONTROLS } from './gates.mjs';

const dir = process.argv[2];
// baseline_missed is deliberately absent. Each arm ran in its own process, and that
// subset is defined relative to whatever baseline was present in the run that produced
// it — so semble's "baseline_missed" holds 49 cases while repowise's holds 81, and the
// two columns are not measuring the same thing. Comparing them would have read as a
// hard-subset finding. no_path_leak survives because it is defined by per-case corpus
// metadata rather than by the run's own contents, and it is 54 cases for every arm.
const SUBSETS = [
  ['all', 'every case'],
  ['no_path_leak', 'cases whose query does not name a file in the answer'],
];

const arms = [];
let meta = null;
for (const file of readdirSync(dir)) {
  if (!file.endsWith('.json') || file.startsWith('EXCLUDED-')) continue;
  const score = JSON.parse(readFileSync(`${dir}/${file}`, 'utf8'));
  meta ??= { repo: score.repository, tier: score.tier, counts: score.corpus_counts };
  for (const p of score.providers ?? []) {
    arms.push({ id: p.provider_id, summary: p.summary, outcomes: p.outcomes ?? {} });
  }
}

const pct = (v) => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '—');
const num = (v) => (Number.isFinite(v) ? Math.round(v).toLocaleString('en-US') : '—');

// A packer that ships the whole repository is not competing on ranking, so it is listed
// apart rather than sorted into the same order. Mixing the two produced the benchmark's
// most misread row: "0.0% recall" for an arm that in fact delivered every required file.
const PACKERS = new Set(['repomix-pack-all', 'repomix-compressed']);
const CONTROLS = new Set(REQUIRED_CONTROLS);

function row(arm, subset) {
  const s = arm.summary[subset];
  if (!s) return null;
  return {
    id: arm.id,
    cases: s.cases,
    r1k: s.mean_recall_at_1000_tokens,
    r4k: s.mean_recall_at_4000_tokens,
    r16k: s.mean_recall_at_16000_tokens,
    tokens: s.median_tokens_delivered,
    latency: s.median_latency_ms,
    unavailable: s.cases ? s.unavailable / s.cases : null,
    answered: arm.outcomes.answered ?? null,
  };
}

const out = [];
out.push(`# Full field on one project — ${meta.repo.id}`);
out.push('');
out.push(
  `\`${meta.repo.id}\` @ \`${meta.repo.head.slice(0, 12)}\` — ${meta.tier} tier, ` +
    `${meta.counts.cases} cases, ${meta.counts.multi_file} of them spanning more than one file. ` +
    `Public repository, so the corpus and every number below can be rebuilt by someone else.`
);
out.push('');

// Gates, on the union.
const ids = arms.map((a) => a.id);
const present = checkControlsPresent(ids);
const scored = arms
  .filter((a) => a.summary.all)
  .map((a) => ({ provider_id: a.id, summary: a.summary }));
const lose = checkControlsLose({ providers: scored });
out.push('## Gates');
out.push('');
out.push(
  `- controls present: **${present.ok ? 'pass' : `FAIL — missing ${present.missing.join(', ')}`}**`
);
out.push(
  `- controls lose to the field: **${lose.ok === false ? `FAIL — ${lose.reason}` : lose.ok ? 'pass' : 'not evaluated'}**`
);
out.push('');

for (const [subset, gloss] of SUBSETS) {
  const rows = arms.map((a) => row(a, subset)).filter(Boolean);
  if (!rows.length) continue;
  const retrievers = rows.filter((r) => !PACKERS.has(r.id));
  retrievers.sort((x, y) => (y.r4k ?? -1) - (x.r4k ?? -1));
  const n = retrievers[0]?.cases ?? 0;
  out.push(`## ${subset} — ${gloss} (${n} cases)`);
  out.push('');
  out.push('| Arm | r@1k | r@4k | r@16k | median tokens | p50 ms | unavailable |');
  out.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const r of retrievers) {
    const label = CONTROLS.has(r.id) ? `_${r.id}_ (control)` : r.id;
    out.push(
      `| ${label} | ${pct(r.r1k)} | ${pct(r.r4k)} | ${pct(r.r16k)} | ${num(r.tokens)} | ${num(r.latency)} | ${pct(r.unavailable)} |`
    );
  }
  out.push('');
  const packers = rows.filter((r) => PACKERS.has(r.id));
  if (packers.length) {
    out.push('Whole-repository packers, listed apart because they do not rank:');
    out.push('');
    out.push('| Arm | r@1k | r@4k | r@16k | median tokens |');
    out.push('| --- | ---: | ---: | ---: | ---: |');
    for (const r of packers) {
      out.push(`| ${r.id} | ${pct(r.r1k)} | ${pct(r.r4k)} | ${pct(r.r16k)} | ${num(r.tokens)} |`);
    }
    out.push('');
  }
}
console.log(out.join('\n'));
