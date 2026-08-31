import { createHash } from 'node:crypto';
import { isAbsolute, relative, sep } from 'node:path';

import { lcovParser } from '@friedemannsommer/lcov-parser/sync';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

import { adaptVerificationReceipt } from './adapters.mjs';

const CANONICAL_VERSION = 'codevetter.project-verification-receipt/v1';
const XML_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: true,
  parseTagValue: true,
  processEntities: false,
  trimValues: true,
};

export function adaptVerificationArtifact({
  bytes,
  relativePath,
  sourceSha256,
  repository,
  repositoryRoot,
}) {
  const text = bytes.toString('utf8');
  const trimmed = text.trimStart();

  if (looksLikeLcov(trimmed)) {
    return {
      receipt: adaptLcov(text, metadata()),
      sourceFormat: 'lcov',
    };
  }

  if (trimmed.startsWith('<')) {
    return adaptXml(text, metadata());
  }

  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('verification artifact is neither supported JSON, XML, nor LCOV');
  }

  try {
    return adaptVerificationReceipt(value, { repositoryId: repository.id });
  } catch (error) {
    if (isPlaywrightJson(value)) {
      return {
        receipt: adaptPlaywrightJson(value, metadata()),
        sourceFormat: 'playwright-json',
      };
    }
    if (isLighthouseJson(value)) {
      return {
        receipt: adaptLighthouseJson(value, metadata()),
        sourceFormat: 'lighthouse-json',
      };
    }
    if (isChromeTraceJson(value)) {
      return {
        receipt: adaptChromeTraceJson(value, metadata()),
        sourceFormat: 'chrome-trace-json',
      };
    }
    throw error;
  }

  function metadata() {
    return { relativePath, sourceSha256, repository, repositoryRoot };
  }
}

export function adaptPlaywrightJson(value, metadata) {
  if (!isPlaywrightJson(value)) throw new Error('artifact is not a Playwright JSON report');
  const entries = [];
  walkPlaywrightSuites(value.suites, [], entries);
  if (entries.length === 0) throw new Error('Playwright JSON report contains no tests');

  const tests = [];
  const attempts = [];
  let retries = 0;
  for (const [testIndex, entry] of entries.entries()) {
    const testId = `playwright:${digest({
      file: entry.file,
      title: entry.title,
      project: entry.projectName,
      index: testIndex,
    }).slice(0, 24)}`;
    tests.push({
      id: testId,
      file: containedProducerPath(entry.file, metadata, metadata.relativePath),
      selected_by: [],
      reason: 'selected by the Playwright producer report',
    });
    const results = entry.results.length > 0 ? entry.results : [{ status: 'interrupted' }];
    retries += Math.max(0, results.length - 1);
    results.forEach((result, resultIndex) => {
      const status = playwrightStatus(result.status);
      attempts.push({
        id: `${testId}:attempt:${resultIndex + 1}`,
        test_id: testId,
        phase: resultIndex === 0 ? 'primary' : 'recheck',
        status,
        duration_ms: nonNegative(result.duration, 0),
        failure_signature: failureSignature('playwright', result.error ?? result.errors, status),
      });
    });
  }

  return testReceipt({
    metadata,
    runner: {
      id: 'playwright-json',
      version: text(value.config?.version, 'unknown'),
      profile: 'json-reporter',
      command: 'playwright test --reporter=json',
    },
    capturedAt: timestamp(value.stats?.startTime),
    tests,
    attempts,
    wallMs: nonNegative(value.stats?.duration, sum(attempts, 'duration_ms')),
    retries,
    limitations: [
      'Adapted from the maintained Playwright JSON reporter; the raw report remains authoritative.',
      'The report does not prove repository revision, process-tree resources, network isolation, or complete test discovery.',
    ],
  });
}

export function adaptJunitXml(document, metadata) {
  const roots = asArray(document.testsuites?.testsuite ?? document.testsuite);
  const cases = [];
  for (const suite of roots) walkJunitSuites(suite, [], cases);
  if (cases.length === 0) throw new Error('JUnit XML report contains no test cases');

  const tests = [];
  const attempts = [];
  for (const [index, entry] of cases.entries()) {
    const file = containedProducerPath(entry['@_file'], metadata, metadata.relativePath);
    const title = [entry['@_classname'], entry['@_name']].filter(Boolean).join(' › ');
    const testId = `junit:${digest({ file, title, index }).slice(0, 24)}`;
    const status = entry.failure
      ? 'failed'
      : entry.error
        ? 'failed'
        : entry.skipped
          ? 'skipped'
          : 'passed';
    tests.push({
      id: testId,
      file,
      selected_by: [],
      reason: 'declared by the JUnit producer report',
    });
    attempts.push({
      id: `${testId}:attempt:1`,
      test_id: testId,
      phase: 'primary',
      status,
      duration_ms: secondsToMs(entry['@_time']),
      failure_signature: failureSignature('junit', entry.failure ?? entry.error, status),
    });
  }

  const firstSuite = roots[0] ?? {};
  return testReceipt({
    metadata,
    runner: {
      id: 'junit-xml',
      version: 'unknown',
      profile: text(firstSuite['@_name'], 'junit'),
      command: 'external producer with JUnit XML reporter',
    },
    capturedAt: timestamp(firstSuite['@_timestamp']),
    tests,
    attempts,
    wallMs: secondsToMs(firstSuite['@_time']) || sum(attempts, 'duration_ms'),
    retries: 0,
    limitations: [
      'Adapted from JUnit XML through fast-xml-parser; the raw report remains authoritative.',
      'JUnit XML does not standardize runner version, retry history, repository revision, or process-tree resources.',
    ],
  });
}

export function adaptLcov(textValue, metadata) {
  let sections;
  try {
    sections = lcovParser({ from: textValue });
  } catch (error) {
    throw new Error(`invalid LCOV report: ${error.message}`);
  }
  if (sections.length === 0) throw new Error('LCOV report contains no source records');
  const totals = sections.reduce(
    (result, section) => {
      result.linesFound += section.lines.instrumented;
      result.linesHit += section.lines.hit;
      result.functionsFound += section.functions.instrumented;
      result.functionsHit += section.functions.hit;
      result.branchesFound += section.branches.instrumented;
      result.branchesHit += section.branches.hit;
      return result;
    },
    {
      linesFound: 0,
      linesHit: 0,
      functionsFound: 0,
      functionsHit: 0,
      branchesFound: 0,
      branchesHit: 0,
    }
  );
  return observationReceipt({
    metadata,
    runner: { id: 'lcov', version: '1', profile: 'coverage', command: 'external LCOV producer' },
    observations: coverageObservations(totals, 'lcov'),
    limitations: [
      'Parsed with @friedemannsommer/lcov-parser; the raw LCOV report remains authoritative.',
      'Coverage is aggregate producer evidence and is not changed-line coverage unless the producer scope proves that separately.',
    ],
  });
}

export function adaptCoberturaXml(coverage, metadata) {
  const totals = {
    linesFound: integerAttribute(coverage, 'lines-valid'),
    linesHit: integerAttribute(coverage, 'lines-covered'),
    functionsFound: 0,
    functionsHit: 0,
    branchesFound: integerAttribute(coverage, 'branches-valid'),
    branchesHit: integerAttribute(coverage, 'branches-covered'),
  };
  if (totals.linesFound === 0 && totals.branchesFound === 0) {
    throw new Error('Cobertura XML report contains no coverage totals');
  }
  return observationReceipt({
    metadata,
    runner: {
      id: 'cobertura-xml',
      version: text(coverage['@_version'], 'unknown'),
      profile: 'coverage',
      command: 'external Cobertura XML producer',
    },
    capturedAt: unixTimestamp(coverage['@_timestamp']),
    observations: coverageObservations(totals, 'cobertura'),
    limitations: [
      'Parsed from Cobertura XML through fast-xml-parser; the raw report remains authoritative.',
      'Coverage is aggregate producer evidence and is not changed-line coverage unless the producer scope proves that separately.',
    ],
  });
}

export function adaptLighthouseJson(value, metadata) {
  if (!isLighthouseJson(value)) throw new Error('artifact is not a Lighthouse JSON report');
  const observations = [];
  addObservation(
    observations,
    'lighthouse.performance.score',
    value.categories?.performance?.score,
    'ratio',
    'navigation'
  );
  for (const [audit, metric] of [
    ['first-contentful-paint', 'lighthouse.fcp'],
    ['largest-contentful-paint', 'lighthouse.lcp'],
    ['interaction-to-next-paint', 'lighthouse.inp'],
    ['total-blocking-time', 'lighthouse.tbt'],
    ['speed-index', 'lighthouse.speed_index'],
    ['cumulative-layout-shift', 'lighthouse.cls'],
  ]) {
    const entry = value.audits?.[audit];
    addObservation(
      observations,
      metric,
      entry?.numericValue,
      text(entry?.numericUnit, audit === 'cumulative-layout-shift' ? 'unitless' : 'millisecond'),
      'navigation'
    );
  }
  if (observations.length === 0)
    throw new Error('Lighthouse JSON report contains no supported metrics');
  return observationReceipt({
    metadata,
    runner: {
      id: 'lighthouse',
      version: text(value.lighthouseVersion, 'unknown'),
      profile: text(value.configSettings?.formFactor, 'unknown-form-factor'),
      command: 'external Lighthouse JSON producer',
    },
    capturedAt: timestamp(value.fetchTime),
    observations,
    limitations: [
      'Lighthouse metrics are observational until repeated, revision-bound, same-scope comparison evidence is supplied.',
      'A Lighthouse category score is not a CodeVetter correctness or shipping verdict.',
    ],
  });
}

export function adaptChromeTraceJson(value, metadata) {
  if (!isChromeTraceJson(value)) throw new Error('artifact is not a Chrome trace JSON report');
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const event of value.traceEvents) {
    if (!Number.isFinite(event?.ts)) continue;
    minimum = Math.min(minimum, event.ts);
    maximum = Math.max(maximum, event.ts + nonNegative(event.dur, 0));
  }
  const observations = [];
  addObservation(observations, 'chrome_trace.events', value.traceEvents.length, 'count', 'trace');
  if (Number.isFinite(minimum) && Number.isFinite(maximum)) {
    addObservation(
      observations,
      'chrome_trace.duration',
      (maximum - minimum) / 1_000,
      'millisecond',
      'trace'
    );
  }
  return observationReceipt({
    metadata,
    runner: {
      id: 'chrome-trace',
      version: 'trace-event-format',
      profile: 'metadata-only',
      command: 'external Chrome DevTools trace producer',
    },
    observations,
    limitations: [
      'Only bounded Chrome trace metadata is normalized; the raw trace remains the source for flame-chart and network analysis.',
      'Trace duration and event count are observational and do not establish Core Web Vitals or an optimization claim.',
    ],
  });
}

function adaptXml(textValue, metadata) {
  const parseableXml = textValue.replace(
    /<!DOCTYPE\s+coverage\s+SYSTEM\s+["']http:\/\/cobertura\.sourceforge\.net\/xml\/coverage-04\.dtd["']\s*>/i,
    ''
  );
  if (/<!DOCTYPE|<!ENTITY/i.test(parseableXml)) {
    throw new Error('XML verification artifacts contain an unsupported document type or entity');
  }
  const validation = XMLValidator.validate(parseableXml);
  if (validation !== true) throw new Error('verification artifact is not valid XML');
  const document = new XMLParser(XML_OPTIONS).parse(parseableXml);
  if (document.coverage) {
    return {
      receipt: adaptCoberturaXml(document.coverage, metadata),
      sourceFormat: 'cobertura-xml',
    };
  }
  if (document.testsuites || document.testsuite) {
    return { receipt: adaptJunitXml(document, metadata), sourceFormat: 'junit-xml' };
  }
  throw new Error('unsupported XML verification artifact format');
}

function testReceipt({
  metadata,
  runner,
  capturedAt,
  tests,
  attempts,
  wallMs,
  retries,
  limitations,
}) {
  const terminal = new Map();
  for (const attempt of attempts) terminal.set(attempt.test_id, attempt.status);
  const statuses = [...terminal.values()];
  return baseReceipt({
    metadata,
    runner,
    capturedAt,
    selection: {
      mode: 'all',
      inventory_id: `${runner.id}-${digest(tests.map((entry) => [entry.id, entry.file]))}`,
      inventory_total: tests.length,
      selector_change_allowed: false,
      changed_files: [],
      tests,
    },
    outcome: {
      total: statuses.filter((status) => status !== 'operational_failure').length,
      passed: statuses.filter((status) => status === 'passed').length,
      failed: statuses.filter((status) => status === 'failed' || status === 'timed_out').length,
      skipped: statuses.filter((status) => status === 'skipped').length,
      operational_failures: statuses.filter((status) => status === 'operational_failure').length,
    },
    attempts,
    wallMs,
    retries,
    inventoryCoverage: 'aggregate',
    selectionCoverage: 'aggregate',
    observations: [],
    limitations,
  });
}

function observationReceipt({ metadata, runner, capturedAt, observations, limitations }) {
  return baseReceipt({
    metadata,
    runner,
    capturedAt,
    selection: {
      mode: 'none',
      inventory_id: `${runner.id}-${metadata.sourceSha256}`,
      inventory_total: 0,
      selector_change_allowed: false,
      changed_files: [],
      tests: [],
    },
    outcome: { total: 0, passed: 0, failed: 0, skipped: 0, operational_failures: 0 },
    attempts: [],
    wallMs: 0,
    retries: 0,
    inventoryCoverage: 'missing',
    selectionCoverage: 'missing',
    observations,
    limitations,
  });
}

function baseReceipt({
  metadata,
  runner,
  capturedAt,
  selection,
  outcome,
  attempts,
  wallMs,
  retries,
  inventoryCoverage,
  selectionCoverage,
  observations,
  limitations,
}) {
  return {
    schema_version: CANONICAL_VERSION,
    captured_at: capturedAt ?? '1970-01-01T00:00:00.000Z',
    subject: {
      repository: metadata.repository,
      runner,
      environment: {
        id: `artifact-ingestion-${process.platform}-${process.arch}-node${process.versions.node}`,
        platform: process.platform,
        arch: process.arch,
        runtime: `Node ${process.versions.node}`,
      },
    },
    selection,
    outcome,
    attempts,
    metrics: {
      wall_ms: wallMs,
      cpu_ms: null,
      peak_rss_bytes: null,
      peak_processes: null,
      samples: { wall_ms: wallMs > 0 ? [wallMs] : [], cpu_ms: [], peak_rss_bytes: [] },
      coverage: {
        inventory: inventoryCoverage,
        cpu: 'missing',
        rss: 'missing',
        process_tree: 'missing',
        network: 'missing',
        fixed_waits: 'missing',
        selection: selectionCoverage,
      },
    },
    safety: { fixed_wait_ms: null, live_network_requests: null, mock_cost_usd: 0, retries },
    budgets: {
      policy_id: `${runner.id}-observational-v1`,
      maxima: {
        wall_ms: null,
        cpu_ms: null,
        peak_rss_bytes: null,
        peak_processes: null,
        fixed_wait_ms: null,
        live_network_requests: null,
        retries: null,
      },
      required_metrics: [],
      regression: {
        relative_percent: 0,
        wall_absolute_ms: 0,
        cpu_absolute_ms: 0,
        peak_rss_absolute_bytes: 0,
        peak_processes_absolute: 0,
      },
    },
    evidence: [{ kind: runner.id, path: metadata.relativePath, sha256: metadata.sourceSha256 }],
    limitations: [...new Set(limitations)].sort(),
    producer_observations: observations,
  };
}

function coverageObservations(totals, scope) {
  const observations = [];
  for (const [metric, value] of [
    ['coverage.lines.found', totals.linesFound],
    ['coverage.lines.hit', totals.linesHit],
    ['coverage.functions.found', totals.functionsFound],
    ['coverage.functions.hit', totals.functionsHit],
    ['coverage.branches.found', totals.branchesFound],
    ['coverage.branches.hit', totals.branchesHit],
  ])
    addObservation(observations, metric, value, 'count', scope);
  return observations;
}

function addObservation(target, metric, value, unit, scope) {
  if (!Number.isFinite(value) || value < 0) return;
  target.push({ metric, value, unit, scope, evidence: 'producer_artifact' });
}

function walkPlaywrightSuites(suites, parents, target) {
  for (const suite of asArray(suites)) {
    const lineage = suite.title ? [...parents, suite.title] : parents;
    for (const spec of asArray(suite.specs)) {
      for (const test of asArray(spec.tests)) {
        target.push({
          file: spec.file ?? suite.file,
          title: [...lineage, spec.title ?? test.title].filter(Boolean).join(' › '),
          projectName: test.projectName ?? 'default',
          results: asArray(test.results),
        });
      }
    }
    walkPlaywrightSuites(suite.suites, lineage, target);
  }
}

function walkJunitSuites(suite, parents, target) {
  if (!suite || typeof suite !== 'object') return;
  const lineage = suite['@_name'] ? [...parents, String(suite['@_name'])] : parents;
  for (const testcase of asArray(suite.testcase)) target.push({ ...testcase, __lineage: lineage });
  for (const child of asArray(suite.testsuite)) walkJunitSuites(child, lineage, target);
}

function containedProducerPath(value, metadata, fallback) {
  if (typeof value !== 'string' || value.trim() === '') return fallback;
  let candidate = value.replaceAll('\\', '/');
  if (isAbsolute(candidate)) {
    candidate = relative(metadata.repositoryRoot, candidate).replaceAll(sep, '/');
  }
  if (
    candidate === '' ||
    candidate.startsWith('../') ||
    candidate.startsWith('/') ||
    candidate.split('/').some((part) => part === '' || part === '.' || part === '..')
  )
    return fallback;
  return candidate;
}

function playwrightStatus(value) {
  if (value === 'passed') return 'passed';
  if (value === 'failed') return 'failed';
  if (value === 'timedOut') return 'timed_out';
  if (value === 'skipped') return 'skipped';
  return 'operational_failure';
}

function failureSignature(prefix, failure, status) {
  if (status === 'passed' || status === 'skipped') return null;
  return `${prefix}-${status}-${digest(failure ?? status).slice(0, 16)}`;
}

function isPlaywrightJson(value) {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    Array.isArray(value.suites) &&
    value.config &&
    value.stats
  );
}

function isLighthouseJson(value) {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    typeof value.lighthouseVersion === 'string' &&
    value.audits
  );
}

function isChromeTraceJson(value) {
  return Boolean(value) && typeof value === 'object' && Array.isArray(value.traceEvents);
}

function looksLikeLcov(value) {
  return /^(?:TN:|SF:)/m.test(value.slice(0, 4_096));
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value, fallback) {
  return typeof value === 'string' && value.trim() !== '' ? value.slice(0, 1_024) : fallback;
}

function timestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : undefined;
}

function unixTimestamp(value) {
  if (!Number.isFinite(value) || value < 0) return undefined;
  const milliseconds = value >= 1_000_000_000_000 ? value : value * 1_000;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function secondsToMs(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed * 1_000 : 0;
}

function integerAttribute(value, name) {
  const parsed = Number(value?.[`@_${name}`]);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function nonNegative(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function sum(values, key) {
  return values.reduce((total, value) => total + nonNegative(value[key], 0), 0);
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
