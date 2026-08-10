import {
  BUNDLE_SCHEMA_VERSION,
  COMPARISON_SCHEMA_VERSION,
  LIMITS,
  assertValidReceipt,
  safeRelativePath,
  sha256,
  stableStringify,
} from './contracts.mjs';

const PERFORMANCE_METRICS = ['wall_ms', 'cpu_ms', 'peak_rss_bytes', 'peak_processes'];
const SAFETY_METRICS = ['fixed_wait_ms', 'live_network_requests', 'retries'];
const METRIC_COVERAGE = {
  wall_ms: null,
  cpu_ms: 'cpu',
  peak_rss_bytes: 'rss',
  peak_processes: 'process_tree',
  fixed_wait_ms: 'fixed_waits',
  live_network_requests: 'network',
  retries: null,
};

export function ingestReceiptDocument(receipt, { sourcePath, sourceSha256 }) {
  assertValidReceipt(receipt);
  const normalizedSourcePath = safeRelativePath(sourcePath, 'source receipt path');
  if (typeof sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sourceSha256)) {
    throw new Error('source receipt SHA-256 must be a lowercase hex digest');
  }
  const taxonomy = classifyReceipt(receipt);
  const graph = buildBlastRadius(receipt);
  const budgetResults = evaluateBudgets(receipt);
  const verdict = deriveVerdict(receipt, taxonomy, budgetResults);
  const limitations = collectLimitations(receipt, taxonomy, graph, budgetResults);
  const payload = {
    schema_version: BUNDLE_SCHEMA_VERSION,
    source_receipt: { path: normalizedSourcePath, sha256: sourceSha256 },
    subject: receipt.subject,
    selection: {
      mode: receipt.selection.mode,
      inventory_id: receipt.selection.inventory_id,
      inventory_total: receipt.selection.inventory_total,
      selected_tests: receipt.selection.tests.length,
      changed_files: receipt.selection.changed_files.length,
    },
    observed: {
      outcome: receipt.outcome,
      metrics: receipt.metrics,
      safety: receipt.safety,
    },
    verdict,
    budget_results: budgetResults,
    taxonomy,
    blast_radius: graph,
    evidence: receipt.evidence,
    limitations,
  };
  return { ...payload, bundle_id: sha256(stableStringify(payload)) };
}

export function compareReceiptDocuments(
  baselineReceipt,
  currentReceipt,
  { baselineSource, currentSource }
) {
  const baseline = ingestReceiptDocument(baselineReceipt, baselineSource);
  const current = ingestReceiptDocument(currentReceipt, currentSource);
  const compatibility = qualifyCompatibility(baselineReceipt, currentReceipt);
  const metrics = compareMetrics(baselineReceipt, currentReceipt, compatibility.kind);
  const failures = compareFailures(baseline.taxonomy, current.taxonomy);
  const inventory = compareInventory(baselineReceipt, currentReceipt);
  const limitations = [];
  if (compatibility.kind === 'cross_commit') {
    limitations.push(
      'Baseline and current revisions differ; performance deltas are directional cross-commit evidence, not a controlled same-commit speedup.'
    );
  }
  if (compatibility.kind === 'incompatible') {
    limitations.push(
      'Receipt identities are incompatible; no regression or improvement conclusion is available.'
    );
  }
  limitations.push(...baseline.limitations.map((item) => `Baseline: ${item}`));
  limitations.push(...current.limitations.map((item) => `Current: ${item}`));

  const status = comparisonStatus({ compatibility, metrics, failures, inventory, current });
  const payload = {
    schema_version: COMPARISON_SCHEMA_VERSION,
    baseline: summarizeBundle(baseline),
    current: summarizeBundle(current),
    compatibility,
    metrics,
    failures,
    inventory,
    verdict: {
      status,
      controlled_performance_claim: compatibility.kind === 'same_commit',
      correctness_status: current.verdict.correctness,
      performance_status: current.verdict.performance,
    },
    limitations: uniqueSorted(limitations),
  };
  return { ...payload, comparison_id: sha256(stableStringify(payload)) };
}

function evaluateBudgets(receipt) {
  const results = [];
  for (const metric of [...PERFORMANCE_METRICS, ...SAFETY_METRICS]) {
    const maximum = receipt.budgets.maxima[metric];
    const observed = observedMetric(receipt, metric);
    const coverageKey = METRIC_COVERAGE[metric];
    const coverage = coverageKey ? receipt.metrics.coverage[coverageKey] : 'complete';
    const required = receipt.budgets.required_metrics.includes(metric);
    let status = 'not_configured';
    let reason = 'No maximum was declared.';
    if (maximum !== null) {
      if (observed === null || (required && coverage !== 'complete')) {
        status = 'no_confidence';
        reason =
          observed === null
            ? 'Required measurement is missing.'
            : `Required coverage is ${coverage}.`;
      } else if (observed > maximum) {
        status = 'failed';
        reason = 'Observed value exceeds the declared maximum.';
      } else {
        status = 'passed';
        reason = 'Observed value is within the declared maximum.';
      }
    } else if (required) {
      status = 'no_confidence';
      reason = 'Required metric has no declared maximum.';
    }
    results.push({ metric, observed, maximum, coverage, required, status, reason });
  }
  return results;
}

function deriveVerdict(receipt, taxonomy, budgetResults) {
  const operational =
    receipt.outcome.operational_failures > 0 || taxonomy.operational_failures.length > 0;
  const correctness = operational
    ? 'no_confidence'
    : receipt.outcome.failed > 0
      ? 'failed'
      : 'passed';
  const performance = componentStatus(
    budgetResults.filter((result) => PERFORMANCE_METRICS.includes(result.metric))
  );
  const safety = componentStatus(
    budgetResults.filter((result) => SAFETY_METRICS.includes(result.metric))
  );
  const inventory = receipt.metrics.coverage.inventory === 'complete' ? 'passed' : 'no_confidence';
  const components = [correctness, performance, safety, inventory];
  let overall = 'passed';
  if (components.includes('failed')) overall = 'failed';
  else if (components.includes('no_confidence')) overall = 'no_confidence';
  else if (receipt.limitations.length > 0 || taxonomy.transient_recoveries.length > 0) {
    overall = 'passed_with_limits';
  }
  return { correctness, performance, safety, inventory, overall };
}

function componentStatus(results) {
  if (results.some((result) => result.status === 'failed')) return 'failed';
  if (results.some((result) => result.status === 'no_confidence')) return 'no_confidence';
  return results.some((result) => result.status === 'passed') ? 'passed' : 'no_confidence';
}

function classifyReceipt(receipt) {
  const attemptsByTest = new Map();
  for (const attempt of receipt.attempts) {
    const entries = attemptsByTest.get(attempt.test_id) ?? [];
    entries.push(attempt);
    attemptsByTest.set(attempt.test_id, entries);
  }
  const stableFailures = [];
  const transientRecoveries = [];
  const timeouts = [];
  const operationalFailures = [];
  for (const [testId, attempts] of attemptsByTest) {
    const final = attempts.at(-1);
    const priorFailures = attempts.filter((attempt) => attempt.status === 'failed');
    if (final.status === 'passed' && priorFailures.length > 0) {
      transientRecoveries.push({
        test_id: testId,
        failure_signatures: uniqueSorted(priorFailures.map((attempt) => attempt.failure_signature)),
      });
    }
    if (final.status === 'failed' || final.status === 'timed_out') {
      stableFailures.push({
        test_id: testId,
        signature: final.failure_signature ?? `timeout:${testId}`,
        status: final.status,
      });
    }
    for (const attempt of attempts) {
      if (attempt.status === 'timed_out')
        timeouts.push({ test_id: testId, attempt_id: attempt.id });
      if (attempt.status === 'operational_failure') {
        operationalFailures.push({ test_id: testId, attempt_id: attempt.id });
      }
    }
  }
  return {
    stable_failures: stableFailures.sort(byTestAndSignature),
    transient_recoveries: transientRecoveries.sort(byTestAndSignature),
    timeouts: timeouts.sort(byTestAndSignature),
    operational_failures: operationalFailures.sort(byTestAndSignature),
    retries: receipt.safety.retries,
    fixed_waits: receipt.safety.fixed_wait_ms,
    live_network_requests: receipt.safety.live_network_requests,
    inventory_coverage: receipt.metrics.coverage.inventory,
    selection_coverage: receipt.metrics.coverage.selection,
  };
}

function buildBlastRadius(receipt) {
  const nodes = [];
  const edges = [];
  for (const file of receipt.selection.changed_files) {
    nodes.push({ id: `file:${file}`, kind: 'changed_file', label: file });
  }
  const finalFailures = new Map(
    classifyReceipt(receipt).stable_failures.map((failure) => [failure.test_id, failure.signature])
  );
  for (const test of receipt.selection.tests) {
    nodes.push({ id: `test:${test.id}`, kind: 'test', label: test.id, source: test.file });
    for (const file of test.selected_by) {
      edges.push({
        from: `file:${file}`,
        to: `test:${test.id}`,
        kind: 'selected_by',
        evidence: 'producer_declared',
        reason: test.reason,
      });
    }
    const signature = finalFailures.get(test.id);
    if (signature) {
      const failureId = `failure:${sha256(signature).slice(0, 16)}`;
      nodes.push({ id: failureId, kind: 'failure_signature', label: signature });
      edges.push({
        from: `test:${test.id}`,
        to: failureId,
        kind: 'failed_with',
        evidence: 'observed_attempt',
        reason: null,
      });
    }
  }
  const dedupedNodes = [...new Map(nodes.map((node) => [node.id, node])).values()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, LIMITS.graphNodes);
  const retainedIds = new Set(dedupedNodes.map((node) => node.id));
  const boundedEdges = edges
    .filter((edge) => retainedIds.has(edge.from) && retainedIds.has(edge.to))
    .sort((a, b) => `${a.from}:${a.to}:${a.kind}`.localeCompare(`${b.from}:${b.to}:${b.kind}`))
    .slice(0, LIMITS.graphEdges);
  return {
    nodes: dedupedNodes,
    edges: boundedEdges,
    truncated:
      dedupedNodes.length < new Set(nodes.map((node) => node.id)).size ||
      boundedEdges.length < edges.length,
  };
}

function collectLimitations(receipt, taxonomy, graph, budgetResults) {
  const limitations = [...receipt.limitations];
  if (receipt.metrics.coverage.inventory !== 'complete') {
    limitations.push(`Test inventory coverage is ${receipt.metrics.coverage.inventory}.`);
  }
  if (receipt.metrics.coverage.selection !== 'complete') {
    limitations.push(
      `Test selection explanation coverage is ${receipt.metrics.coverage.selection}.`
    );
  }
  if (receipt.metrics.coverage.process_tree !== 'complete') {
    limitations.push(`Process-tree resource coverage is ${receipt.metrics.coverage.process_tree}.`);
  }
  if (receipt.selection.tests.some((test) => test.selected_by.length === 0)) {
    limitations.push(
      'At least one executed test has no declared changed-file selection relationship.'
    );
  }
  if (taxonomy.transient_recoveries.length > 0) {
    limitations.push('One or more failures recovered only after a bounded recheck.');
  }
  if (budgetResults.some((result) => result.status === 'no_confidence')) {
    limitations.push('At least one required budget could not be evaluated with complete evidence.');
  }
  if (graph.truncated)
    limitations.push('Blast-radius evidence exceeded graph bounds and was truncated.');
  return uniqueSorted(limitations);
}

function qualifyCompatibility(baseline, current) {
  const checks = [
    ['schema_version', baseline.schema_version, current.schema_version],
    ['repository', baseline.subject.repository.id, current.subject.repository.id],
    ['dirty_state', baseline.subject.repository.dirty, current.subject.repository.dirty],
    ['runner_id', baseline.subject.runner.id, current.subject.runner.id],
    ['runner_version', baseline.subject.runner.version, current.subject.runner.version],
    ['runner_profile', baseline.subject.runner.profile, current.subject.runner.profile],
    ['runner_command', baseline.subject.runner.command, current.subject.runner.command],
    [
      'environment',
      stableStringify(baseline.subject.environment),
      stableStringify(current.subject.environment),
    ],
    ['inventory', baseline.selection.inventory_id, current.selection.inventory_id],
    ['budget_policy', stableStringify(baseline.budgets), stableStringify(current.budgets)],
  ];
  const mismatches = checks
    .filter(([, before, after]) => before !== after)
    .map(([field, baselineValue, currentValue]) => ({
      field,
      baseline: baselineValue,
      current: currentValue,
    }));
  const kind =
    mismatches.length > 0
      ? 'incompatible'
      : baseline.subject.repository.revision === current.subject.repository.revision
        ? 'same_commit'
        : 'cross_commit';
  return {
    kind,
    mismatches,
    baseline_revision: baseline.subject.repository.revision,
    current_revision: current.subject.repository.revision,
  };
}

function compareMetrics(baseline, current, compatibility) {
  const thresholds = current.budgets.regression;
  const definitions = [
    ['wall_ms', thresholds.wall_absolute_ms],
    ['cpu_ms', thresholds.cpu_absolute_ms],
    ['peak_rss_bytes', thresholds.peak_rss_absolute_bytes],
    ['peak_processes', thresholds.peak_processes_absolute],
  ];
  return definitions.map(([metric, absoluteThreshold]) => {
    const before = observedMetric(baseline, metric);
    const after = observedMetric(current, metric);
    const delta = before === null || after === null ? null : after - before;
    const percent = delta === null || before === 0 ? null : (delta / before) * 100;
    let conclusion = 'unavailable';
    if (delta !== null) {
      if (compatibility === 'incompatible') conclusion = 'unavailable';
      else if (compatibility !== 'same_commit') conclusion = 'observed_only';
      else if (
        Math.abs(delta) < absoluteThreshold ||
        Math.abs(percent ?? 0) < thresholds.relative_percent
      ) {
        conclusion = 'stable';
      } else conclusion = delta > 0 ? 'regressed' : 'improved';
    }
    return {
      metric,
      baseline: before,
      current: after,
      absolute_delta: delta,
      percent_delta: percent,
      baseline_samples: sampleCount(baseline, metric),
      current_samples: sampleCount(current, metric),
      thresholds: { absolute: absoluteThreshold, relative_percent: thresholds.relative_percent },
      conclusion,
    };
  });
}

function compareFailures(baseline, current) {
  const before = new Set(baseline.stable_failures.map((failure) => failure.signature));
  const after = new Set(current.stable_failures.map((failure) => failure.signature));
  return {
    new: [...after].filter((value) => !before.has(value)).sort(),
    recovered: [...before].filter((value) => !after.has(value)).sort(),
    stable: [...after].filter((value) => before.has(value)).sort(),
    transient_recoveries: current.transient_recoveries,
  };
}

function compareInventory(baseline, current) {
  const before = new Set(baseline.selection.tests.map((test) => test.id));
  const after = new Set(current.selection.tests.map((test) => test.id));
  const added = [...after].filter((value) => !before.has(value)).sort();
  const removed = [...before].filter((value) => !after.has(value)).sort();
  let classification = 'unchanged';
  if (added.length > 0 && removed.length > 0) classification = 'drift';
  else if (added.length > 0) classification = 'selector_widening';
  else if (removed.length > 0) {
    classification = current.selection.selector_change_allowed
      ? 'allowed_selector_narrowing'
      : 'unsafe_selector_narrowing';
  } else if (baseline.selection.inventory_total !== current.selection.inventory_total) {
    classification = 'inventory_drift';
  }
  return {
    baseline_declared_total: baseline.selection.inventory_total,
    current_declared_total: current.selection.inventory_total,
    baseline_selected: before.size,
    current_selected: after.size,
    added_tests: added,
    removed_tests: removed,
    classification,
  };
}

function comparisonStatus({ compatibility, metrics, failures, inventory, current }) {
  if (compatibility.kind === 'incompatible') return 'no_confidence';
  if (compatibility.kind === 'cross_commit') return 'observed_only';
  if (
    current.verdict.overall === 'failed' ||
    failures.new.length > 0 ||
    inventory.classification === 'unsafe_selector_narrowing' ||
    metrics.some((metric) => metric.conclusion === 'regressed')
  )
    return 'regressed';
  if (failures.recovered.length > 0 || metrics.some((metric) => metric.conclusion === 'improved'))
    return 'improved';
  if (current.verdict.overall === 'no_confidence') return 'no_confidence';
  return 'stable';
}

function observedMetric(receipt, metric) {
  if (metric in receipt.metrics) return receipt.metrics[metric];
  return receipt.safety[metric];
}

function sampleCount(receipt, metric) {
  const samples = receipt.metrics.samples[metric];
  return Array.isArray(samples) ? samples.length : observedMetric(receipt, metric) === null ? 0 : 1;
}

function summarizeBundle(bundle) {
  return {
    bundle_id: bundle.bundle_id,
    source_receipt: bundle.source_receipt,
    revision: bundle.subject.repository.revision,
    verdict: bundle.verdict,
  };
}

function byTestAndSignature(a, b) {
  return `${a.test_id}:${a.signature ?? a.attempt_id ?? ''}`.localeCompare(
    `${b.test_id}:${b.signature ?? b.attempt_id ?? ''}`
  );
}

function uniqueSorted(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined))].sort();
}
