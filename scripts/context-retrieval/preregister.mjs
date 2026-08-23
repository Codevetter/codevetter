#!/usr/bin/env node

// Pre-registration.
//
// The budget you choose determines the winner: on one repository codesearch wins at
// 1k, semble at 4k and gitnexus at 16k. Choosing the budget after seeing results is
// therefore choosing the winner, and it is indistinguishable in the final artifact
// from having chosen it honestly beforehand.
//
// So the plan is written first, hashed, and committed. The hash goes into every
// report. If the plan changes after results exist, the hash changes, and git history
// shows when relative to the run. That does not prevent gaming; it makes gaming
// leave a trace, which is the most any format can do.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Fields that define the experiment. Anything here is frozen before the first run.
const PLAN_FIELDS = [
  'budgets',
  'primary_metric',
  'tiers',
  'repositories',
  'providers',
  'controls',
  'cases_per_repository',
  'protocol_by_tier',
];

export function planHash(plan) {
  // Canonical form: only the declared fields, keys sorted, so incidental edits like
  // comments or field order do not change the hash but a metric change does.
  const canonical = {};
  for (const field of PLAN_FIELDS.slice().sort()) {
    if (plan[field] !== undefined) canonical[field] = sortDeep(plan[field]);
  }
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 16);
}

function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortDeep(value[key]);
    return out;
  }
  return value;
}

export function validatePlan(plan) {
  const problems = [];
  for (const field of PLAN_FIELDS) {
    if (plan[field] === undefined) problems.push(`missing required field: ${field}`);
  }
  if (Array.isArray(plan.budgets) && plan.budgets.length < 2) {
    // A single budget is the same failure as picking one afterwards: it hides that
    // the ranking is budget-dependent.
    problems.push('at least two budgets are required so budget-dependence stays visible');
  }
  if (Array.isArray(plan.controls) && plan.controls.length === 0) {
    problems.push('at least one query-blind control is required');
  }
  return { ok: problems.length === 0, problems };
}

// A report may only claim to follow a plan if the plan it was run against still
// hashes the same. Verified at report time, not trusted.
export function verifyAgainstPlan({ plan, declaredHash }) {
  const actual = planHash(plan);
  return {
    ok: actual === declaredHash,
    actual,
    declared: declaredHash,
    reason:
      actual === declaredHash
        ? null
        : `plan hash mismatch: report claims ${declaredHash}, plan hashes to ${actual}. The experiment definition changed after the run.`,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  if (!path) throw new Error('usage: preregister.mjs <plan.json>');
  const plan = JSON.parse(readFileSync(path, 'utf8'));
  const validation = validatePlan(plan);
  process.stdout.write(
    `${JSON.stringify({ plan_hash: planHash(plan), ...validation }, null, 2)}\n`
  );
  if (!validation.ok) process.exitCode = 1;
}
