import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  renderHtml,
  scoreManifest,
  validateManifest,
} from './run-structural-context-evaluation.mjs';

const fixturePath = new URL('../benchmarks/structural-context/sample.json', import.meta.url);

function fixture() {
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

function runBy(data, pairId, arm) {
  return data.runs.find((run) => run.pair_id === pairId && run.arm === arm);
}

test('synthetic fixture scores paired outcomes without qualifying a product claim', () => {
  const data = fixture();
  assert.deepEqual(validateManifest(data), []);

  const scorecard = scoreManifest(data, 'sample.json');
  assert.equal(scorecard.qualification.state, 'unqualified');
  assert.match(scorecard.qualification.claim, /Synthetic contract fixture only/);
  assert.equal(scorecard.ab.complete_pairs, 2);
  assert.equal(scorecard.ab.control_success_rate, 0.5);
  assert.equal(scorecard.ab.treatment_success_rate, 1);
  assert.equal(scorecard.ab.success_rate_delta, 0.5);
  assert.equal(scorecard.ab.treatment_wins, 1);
  assert.equal(scorecard.ab.tie_pass, 1);
  assert.equal(scorecard.aa.discordance_rate, 0);
  assert.deepEqual(scorecard.invalid_pairs, []);
});

test('the same complete real receipts qualify the predeclared improvement', () => {
  const data = fixture();
  data.experiment.evidence_kind = 'real';

  const scorecard = scoreManifest(data);
  assert.equal(scorecard.qualification.state, 'qualified_improvement');
  assert.match(scorecard.qualification.claim, /improved task success/);
  assert.ok(
    [...scorecard.qualification.evidence_gates, ...scorecard.qualification.effect_gates].every(
      (gate) => gate.pass
    )
  );
});

test('exact pairing excludes mismatched identities', () => {
  const data = fixture();
  runBy(data, 'ab-cache-1', 'treatment').identities.configuration_sha256 =
    '9999999999999999999999999999999999999999999999999999999999999999';

  const scorecard = scoreManifest(data);
  assert.equal(scorecard.ab.complete_pairs, 1);
  assert.deepEqual(scorecard.invalid_pairs[0], {
    pair_id: 'ab-cache-1',
    comparison: 'ab',
    reasons: ['arms use different common identities'],
  });
});

test('stale treatment graph snapshots are excluded', () => {
  const data = fixture();
  runBy(data, 'ab-cache-1', 'treatment').context.graph.indexed_revision =
    'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd';

  const scorecard = scoreManifest(data);
  assert.equal(scorecard.ab.complete_pairs, 1);
  assert.deepEqual(scorecard.invalid_pairs[0].reasons, ['treatment graph snapshot is stale']);
});

test('graph calls contaminate and exclude the control arm', () => {
  const data = fixture();
  runBy(data, 'ab-cache-1', 'control').diagnostics.tool_calls.push('graph_query');

  const scorecard = scoreManifest(data);
  assert.equal(scorecard.ab.complete_pairs, 1);
  assert.deepEqual(scorecard.invalid_pairs[0].reasons, ['control invoked a graph tool']);
});

test('missing required checks remain an incomplete-check outcome', () => {
  const data = fixture();
  runBy(data, 'ab-cache-1', 'treatment').outcome.checks.pop();

  assert.deepEqual(validateManifest(data), []);
  const scorecard = scoreManifest(data);
  const pair = scorecard.ab.pairs.find((entry) => entry.pair_id === 'ab-cache-1');
  assert.equal(pair.treatment.outcome, 'incomplete_checks');
  assert.equal(pair.treatment.success, false);
  assert.equal(scorecard.ab.treatment_wins, 0);
  assert.equal(scorecard.ab.tie_fail, 1);
});

test('setup, agent, timeout, check, regression, and success outcomes stay distinct', () => {
  const expected = new Map([
    ['setup_failed', 'setup_failed'],
    ['agent_failed', 'agent_failed'],
    ['timed_out', 'timed_out'],
    ['completed', 'check_failure'],
  ]);

  for (const [status, normalized] of expected) {
    const data = fixture();
    const treatment = runBy(data, 'ab-cache-1', 'treatment');
    treatment.outcome.status = status;
    if (status === 'completed') treatment.outcome.checks[0].status = 'fail';
    const pair = scoreManifest(data).ab.pairs.find((entry) => entry.pair_id === 'ab-cache-1');
    assert.equal(pair.treatment.outcome, normalized);
  }

  const regressionData = fixture();
  runBy(regressionData, 'ab-cache-1', 'treatment').outcome.regression_count = 1;
  const regressionPair = scoreManifest(regressionData).ab.pairs.find(
    (entry) => entry.pair_id === 'ab-cache-1'
  );
  assert.equal(regressionPair.treatment.outcome, 'regression');

  const successPair = scoreManifest(fixture()).ab.pairs.find(
    (entry) => entry.pair_id === 'ab-cache-1'
  );
  assert.equal(successPair.treatment.outcome, 'success');
});

test('optional diagnostics use only complete pairs and never coerce missing values to zero', () => {
  const data = fixture();
  delete runBy(data, 'ab-cache-1', 'treatment').diagnostics.input_tokens;
  delete runBy(data, 'ab-auth-1', 'control').diagnostics.files_inspected;

  const diagnostics = scoreManifest(data).ab.diagnostics;
  assert.deepEqual(diagnostics.input_tokens, {
    paired_count: 1,
    total_pairs: 2,
    control: 1700,
    treatment: 1500,
    delta: -200,
  });
  assert.deepEqual(diagnostics.files_inspected, {
    paired_count: 1,
    total_pairs: 2,
    control: 3,
    treatment: 2,
    delta: -1,
  });
});

test('A/A disagreement fails the declared noise gate', () => {
  const data = fixture();
  runBy(data, 'aa-cache-1', 'b').outcome.checks[0].status = 'fail';

  const scorecard = scoreManifest(data);
  assert.equal(scorecard.aa.discordant_pairs, 1);
  assert.equal(scorecard.aa.discordance_rate, 0.5);
  assert.equal(
    scorecard.qualification.evidence_gates.find((gate) => gate.id === 'aa_noise').pass,
    false
  );
  assert.equal(scorecard.qualification.state, 'unqualified');
});

test('A/A pairs with different graph-tool access are excluded from noise', () => {
  const data = fixture();
  runBy(data, 'aa-cache-1', 'b').context.allowed_graph_tools = ['graph_query'];

  const scorecard = scoreManifest(data);
  assert.equal(scorecard.aa.complete_pairs, 1);
  assert.deepEqual(scorecard.invalid_pairs.find((pair) => pair.pair_id === 'aa-cache-1').reasons, [
    'A/A arms allow different graph tools',
  ]);
  assert.equal(
    scorecard.qualification.evidence_gates.find((gate) => gate.id === 'pair_integrity').pass,
    false
  );
});

test('scorecard ordering is deterministic', () => {
  const data = fixture();
  const first = JSON.stringify(scoreManifest(data, 'sample.json'));
  data.runs.reverse();
  const second = JSON.stringify(scoreManifest(data, 'sample.json'));

  assert.equal(second, first);
});

test('HTML is self-contained, qualification-first, responsive, and embeds the JSON scorecard', () => {
  const scorecard = scoreManifest(fixture(), 'sample.json');
  const report = renderHtml(scorecard);
  const embedded = report.match(
    /<script type="application\/json" id="codevetter-scorecard">([\s\S]+?)<\/script>/
  );

  assert.ok(embedded);
  assert.deepEqual(JSON.parse(embedded[1]), scorecard);
  assert.ok(report.indexOf(scorecard.qualification.claim) < report.indexOf('Paired outcome'));
  assert.match(report, /name="viewport"/);
  assert.match(report, /@media\(max-width:460px\)/);
  assert.match(report, /<main>/);
  assert.match(report, /<table>/);
  assert.match(report, /A negative delta means less activity, not necessarily a better result/);
  assert.match(report, /data-label="Treatment"/);
  assert.doesNotMatch(report, /https?:\/\//);
  assert.doesNotMatch(report, /<script[^>]+src=/);
});

test('HTML with no valid A/B pairs withholds the comparison corridor', () => {
  const data = fixture();
  for (const run of data.runs.filter((entry) => entry.comparison === 'ab')) {
    if (run.arm === 'treatment') run.context.graph.indexed_revision = '0'.repeat(64);
  }

  const report = renderHtml(scoreManifest(data));
  assert.match(report, /No valid A\/B pairs/);
  assert.doesNotMatch(report, /successful runs/);
});

test('manifest validation rejects malformed immutable identities and policies', () => {
  const data = fixture();
  data.tasks[0].repository_revision = 'not-a-sha';
  data.experiment.qualification_policy.minimum_complete_pairs = 0;

  const errors = validateManifest(data);
  assert.ok(
    errors.some((error) => error.includes('repository_revision must be a lowercase sha256'))
  );
  assert.ok(errors.some((error) => error.includes('minimum_complete_pairs must be at least 1')));
});
