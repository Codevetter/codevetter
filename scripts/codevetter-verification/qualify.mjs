#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createPlan, loadConfig, SCHEMA_VERSION } from './core.mjs';

const config = await loadConfig();
const corpusUrl = new URL('./fixtures/change-corpus-v1.json', import.meta.url);
const corpusBytes = await readFile(corpusUrl);
const corpus = JSON.parse(corpusBytes);
if (corpus.schemaVersion !== SCHEMA_VERSION || !Array.isArray(corpus.cases))
  throw new Error('Invalid verification qualification corpus');

const results = [];
let selectedFailures = 0;
for (const entry of corpus.cases) {
  const identity = createHash('sha256')
    .update(entry.id)
    .update('\0')
    .update(entry.paths.join('\0'))
    .digest('hex');
  const hints = (entry.hints ?? []).map((hint) => ({ ...hint, sourceIdentity: identity }));
  const plan = createPlan({
    config,
    change: { mode: 'worktree', revision: 'corpus', identity, paths: entry.paths },
    hints,
  });
  const lanes = new Set(plan.lanes.map((lane) => lane.id));
  const missing = entry.mustInclude.filter((lane) => !lanes.has(lane));
  const failureCovered = lanes.has(entry.failingLane);
  const passed = plan.focused === entry.focused && missing.length === 0 && failureCovered;
  if (!failureCovered) selectedFailures += 1;
  results.push({
    id: entry.id,
    passed,
    focused: plan.focused,
    missing,
    failureCovered,
    selectedLanes: [...lanes],
  });
}
const passed = results.every((result) => result.passed) && selectedFailures === 0;
const report = {
  schemaVersion: SCHEMA_VERSION,
  corpusIdentity: createHash('sha256').update(corpusBytes).digest('hex'),
  selectorIdentity: createHash('sha256')
    .update(JSON.stringify(config.rules))
    .update(JSON.stringify(config.sharedPatterns))
    .digest('hex'),
  caseCount: results.length,
  selectionRecall: (results.length - selectedFailures) / results.length,
  passed,
  results,
  limitations: [
    'This gate qualifies deterministic lane selection, not application verdicts.',
    'Selected-versus-exhaustive runtime qualification remains required before focused mode becomes a default.',
  ],
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!passed) process.exitCode = 1;
