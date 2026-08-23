#!/usr/bin/env node

// Reliability gates.
//
// Each of these was a convention followed by hand in the first version of this
// benchmark, and conventions rot. Every one corresponds to a specific bug that
// actually shipped a wrong number, so they are checks rather than advice.

// The single highest-value check. A control that never reads the query appeared to
// beat shipping products at 37.3% recall, and nothing except the control itself
// revealed that the metric was broken. A report without controls is unfalsifiable.
// random-code-files is required alongside random-files because widening the random pool
// to every tracked file — necessary, since ground truth is not restricted to code —
// made the floor weaker and made this gate easier to pass. The conservative draw keeps
// the gate honest.
export const REQUIRED_CONTROLS = ['random-files', 'random-code-files', 'churn-ranked'];

export function checkControlsPresent(providerIds) {
  const missing = REQUIRED_CONTROLS.filter((id) => !providerIds.includes(id));
  return {
    ok: missing.length === 0,
    missing,
    reason: missing.length
      ? `controls absent: ${missing.join(', ')}. A query-blind control is the only thing that detects a broken metric.`
      : null,
  };
}

// A query-blind arm scoring near the leaders means the metric is measuring something
// other than retrieval. Checked numerically so it cannot be rationalised away.
export function checkControlsLose({ providers, budget = 'mean_recall_at_4000_tokens' }) {
  const score = (id) => providers.find((p) => p.provider_id === id)?.summary?.all?.[budget] ?? 0;
  const best = Math.max(
    ...providers
      .filter((p) => !REQUIRED_CONTROLS.includes(p.provider_id))
      .map((p) => p.summary?.all?.[budget] ?? 0),
    0
  );
  const worstControl = Math.max(...REQUIRED_CONTROLS.map(score), 0);
  // A control within half the leader's score is not a plausible retrieval result.
  const ok = best > 0 && worstControl < best * 0.5;
  return {
    ok,
    best,
    control: worstControl,
    reason: ok
      ? null
      : `a query-blind control scored ${(worstControl * 100).toFixed(1)}% against a leader's ${(best * 100).toFixed(1)}%. Suspect the metric, not the tools.`,
  };
}

// Outcomes must stay separated. Over half the candidate registry failed to install
// rather than failing to retrieve, and collapsing those into one number is the
// largest single distortion available to a benchmark in this category.
export const OUTCOMES = [
  'answered',
  'did-not-install',
  'did-not-index',
  // A provider that builds an index and then refuses to load it because the index
  // breaches its own configured ceiling. Distinct from did-not-index on purpose:
  // the extraction succeeded and the product declined the result, which is the most
  // important thing this benchmark can report about a tool's usable scale.
  'refused-own-capacity-limit',
  'indexed-but-returned-nothing',
  'unavailable-at-query-time',
];

export function classifyOutcome(response) {
  if (!response) return 'unavailable-at-query-time';
  const reason = response.unavailable_reason;
  if (!reason) return response.files?.length ? 'answered' : 'indexed-but-returned-nothing';
  if (/install|not found|command not found|ENOENT/i.test(reason)) return 'did-not-install';
  // Checked before the generic index test, since these reasons also contain "import".
  if (/exceeds?[- ].*limit|import[- ]limit|too (large|big)|safety limit/i.test(reason))
    return 'refused-own-capacity-limit';
  if (/index/i.test(reason)) return 'did-not-index';
  if (/no output|no-paths|no matches/i.test(reason)) return 'indexed-but-returned-nothing';
  return 'unavailable-at-query-time';
}

// Six arms had multi-repository numbers and six had one repository, printed in the
// same table with nothing to distinguish them. Coverage travels with the row or the
// row is misleading by construction.
export function coverageOf(entry) {
  const repos = [...new Set(entry.repos ?? [])].sort();
  const tiers = [...new Set(entry.tiers ?? [])].sort();
  return {
    repos,
    tiers,
    label: `${tiers.join('+') || 'untiered'} · ${repos.length} repo${repos.length === 1 ? '' : 's'}`,
    // A single repository in a single tier is a hint, not a finding.
    strength: repos.length === 1 ? 'single-repo' : repos.length < 4 ? 'narrow' : 'broad',
  };
}

// A ranking is only defensible if the arms in it were measured on comparable
// evidence. The small tier at one point ranked a single-repository 75.1% above a
// four-repository 50.4% as though they were the same kind of claim. They are not:
// one is a hint, the other is a finding. This does not reorder anything — it states
// the minimum coverage present, so a ranking drawn from mixed evidence has to say so.
export function checkRankingComparable(rows, { minRepos = 2, minCaseShare = 0.9 } = {}) {
  const scored = rows.filter((row) => !REQUIRED_CONTROLS.includes(row.provider_id));
  const thin = scored.filter((row) => (row.coverage?.repos?.length ?? 0) < minRepos);
  const counts = [...new Set(scored.map((row) => row.coverage?.repos?.length ?? 0))].sort();
  // Repo count alone is not enough. An arm abandoned partway through a repository
  // still lists that repository in its coverage while having been scored on a
  // fraction of its cases — one arm here holds 160 of 242 cases yet looks fully
  // covered. Ranking it against arms that answered all 242 is the same error as
  // mixing single-repo and multi-repo evidence, one level down.
  const maxCases = Math.max(...scored.map((row) => row.cases ?? 0), 0);
  const partial = maxCases
    ? scored.filter((row) => (row.cases ?? 0) < maxCases * minCaseShare)
    : [];
  const problems = [];
  if (thin.length) {
    problems.push(
      `${thin.length} arm(s) measured on fewer than ${minRepos} repositories (${thin
        .map((row) => row.provider_id)
        .join(', ')})`
    );
  }
  for (const row of partial) {
    problems.push(
      `${row.provider_id} scored on ${row.cases}/${maxCases} cases (${Math.round(((row.cases ?? 0) / maxCases) * 100)}% of the corpus)`
    );
  }
  return {
    ok: problems.length === 0,
    min_repos_present: counts[0] ?? 0,
    thin_arms: thin.map((row) => row.provider_id),
    partial_arms: partial.map((row) => row.provider_id),
    reason: problems.length
      ? `${problems.join('; ')}. A ranking mixing evidence of different strengths is not defensible; mark or exclude these rows.`
      : null,
  };
}

// Extreme values are claims about the instrument. Four arms scored 0.0% here for
// four unrelated harness bugs and zero tool defects; all four were caught only
// because zero is implausible. This surfaces them as requiring a raw-payload check
// rather than trusting them.
export function flagExtremes(providers, { budget = 'mean_recall_at_4000_tokens' } = {}) {
  const flagged = [];
  for (const p of providers) {
    const value = p.summary?.all?.[budget] ?? 0;
    const cases = p.summary?.all?.cases ?? 0;
    const unavailable = p.summary?.all?.unavailable ?? 0;
    if (REQUIRED_CONTROLS.includes(p.provider_id)) continue;
    if (value === 0) {
      flagged.push({
        provider_id: p.provider_id,
        why: 'scored exactly zero — read the raw payload before believing it',
      });
    } else if (cases > 0 && unavailable === cases) {
      flagged.push({
        provider_id: p.provider_id,
        why: 'unavailable on every case — usually setup, not the tool',
      });
    } else if (value >= 0.95) {
      flagged.push({
        provider_id: p.provider_id,
        why: 'near-perfect recall — check for answer leakage into the index',
      });
    }
  }
  return flagged;
}

// The plausible middle is where bias hides, and it is exactly what got no scrutiny
// in the first version. Deterministic sampling so the same run always nominates the
// same cases for hand-verification and the sample cannot be reshuffled until it
// looks acceptable.
export function nominateForAudit({ providers, perProvider = 2 }) {
  const nominations = [];
  for (const p of providers) {
    const cases = (p.cases ?? []).filter(
      (c) => (c.measures?.recall_at_10 ?? 0) > 0 && (c.measures?.recall_at_10 ?? 0) < 1
    );
    if (cases.length === 0) continue;
    // Fixed stride from a fixed offset: reproducible, and spread across the run.
    const stride = Math.max(1, Math.floor(cases.length / perProvider));
    for (
      let i = 0;
      i < cases.length && nominations.length < perProvider * providers.length;
      i += stride
    ) {
      nominations.push({
        provider_id: p.provider_id,
        query: cases[i].case?.query,
        revision: cases[i].case?.base_revision,
        returned: cases[i].response?.files?.slice(0, 5),
        expected: cases[i].case?.changed_files,
      });
    }
  }
  return nominations;
}
