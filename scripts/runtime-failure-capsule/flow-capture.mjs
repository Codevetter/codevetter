import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { LIMITS } from './contracts.mjs';

const EVENT_SCHEMA = 'codevetter-node-flow-events/v1';
const EVENT_KINDS = new Set(['database', 'http_client', 'http_server']);
const SQLITE_OPERATIONS = new Set(['all', 'exec', 'get', 'run']);

export async function collectNodeFlowEvents(directory) {
  let names;
  try {
    names = (await readdir(directory)).filter((name) => /^flow-\d+\.json$/.test(name)).sort();
  } catch {
    return emptyFlowEvidence(['The Node flow artifact directory was unavailable.']);
  }
  const events = [];
  let bytes = 0;
  let truncated = names.length > LIMITS.flowFiles;
  for (const name of names.slice(0, LIMITS.flowFiles)) {
    const path = join(directory, name);
    let metadata;
    try {
      metadata = await stat(path);
    } catch {
      truncated = true;
      continue;
    }
    bytes += metadata.size;
    if (!metadata.isFile() || metadata.size > LIMITS.flowBytes || bytes > LIMITS.flowBytes) {
      truncated = true;
      continue;
    }
    try {
      const document = JSON.parse(await readFile(path, 'utf8'));
      if (document?.schema_version !== EVENT_SCHEMA || !Array.isArray(document.events)) {
        truncated = true;
        continue;
      }
      for (const event of document.events) {
        const normalized = normalizeEvent(event);
        if (normalized) events.push(normalized);
        if (events.length >= LIMITS.flows) {
          truncated = true;
          break;
        }
      }
    } catch {
      truncated = true;
    }
    if (events.length >= LIMITS.flows) break;
  }
  return {
    files: names.length,
    bytes,
    events: events
      .toSorted(
        (left, right) =>
          left.started_at_ms - right.started_at_ms || left.kind.localeCompare(right.kind)
      )
      .slice(0, LIMITS.flows),
    truncated,
    limitations:
      names.length === 0
        ? ['The diagnostic execution produced no supported Node flow events.']
        : [],
  };
}

export function normalizeNodeFlowEvents(events, rootDurationMs) {
  const flows = [
    {
      id: 'flow-1',
      parent_flow_id: null,
      kind: 'workload',
      name: 'exact local workload',
      timing: {
        duration_ms: Number.isFinite(rootDurationMs) ? rootDurationMs : null,
        provenance: 'unprofiled_measurement_median',
      },
      evidence_ids: ['wall-time-distribution'],
      limitations: [
        'Child timings come from a separate diagnostic execution and are not additive to the root median.',
      ],
    },
  ];
  const relationships = [];
  const evidence = [];
  const normalizedEvents = (Array.isArray(events) ? events : []).slice(0, LIMITS.flows - 1);
  const eventToFlow = new Map();
  for (const [index, event] of normalizedEvents.entries()) {
    const id = `flow-${index + 2}`;
    const evidenceId = `flow-event-${index + 1}`;
    if (event.event_id) eventToFlow.set(event.event_id, id);
    flows.push({
      id,
      parent_flow_id: 'flow-1',
      kind: event.kind,
      name: flowName(event),
      timing: {
        duration_ms: event.duration_ms,
        started_at_ms: event.started_at_ms,
        provenance: 'node_diagnostic_flow_pass',
      },
      attributes: flowAttributes(event),
      evidence_ids: [evidenceId],
      limitations: [],
    });
    evidence.push({ id: evidenceId, ...event, provenance: 'node_diagnostic_preload' });
  }

  for (const [index, event] of normalizedEvents.entries()) {
    const parentFlowId = event.parent_event_id ? eventToFlow.get(event.parent_event_id) : null;
    if (parentFlowId) flows[index + 1].parent_flow_id = parentFlowId;
  }

  for (const client of flows.filter((flow) => flow.kind === 'http_client')) {
    const match = flows
      .filter(
        (flow) =>
          flow.kind === 'http_server' &&
          flow.attributes.method === client.attributes.method &&
          flow.attributes.route === client.attributes.route &&
          flow.timing.started_at_ms >= client.timing.started_at_ms &&
          flow.timing.started_at_ms <= client.timing.started_at_ms + client.timing.duration_ms + 5
      )
      .toSorted(
        (left, right) =>
          Math.abs(left.timing.started_at_ms - client.timing.started_at_ms) -
          Math.abs(right.timing.started_at_ms - client.timing.started_at_ms)
      )[0];
    if (!match) continue;
    if (match.parent_flow_id === 'flow-1') match.parent_flow_id = client.id;
    relationships.push({ kind: 'caused', from_flow_id: client.id, to_flow_id: match.id });
  }

  for (const flow of flows.slice(1)) {
    relationships.push({
      kind: 'contains',
      from_flow_id: flow.parent_flow_id ?? 'flow-1',
      to_flow_id: flow.id,
    });
  }
  addTimingBreakdowns(flows);

  const capturedKinds = [...new Set(normalizedEvents.map((event) => event.kind))].sort();
  return {
    root_flow_id: 'flow-1',
    flows,
    relationships,
    evidence,
    coverage: {
      captured_kinds: capturedKinds,
      child_flow_count: Math.max(0, flows.length - 1),
      operation_summary: summarizeOperations(normalizedEvents),
      root_accounting: 'unavailable_across_separate_executions',
      unaccounted_ms: null,
    },
  };
}

function normalizeEvent(event) {
  if (!event || !EVENT_KINDS.has(event.kind)) return null;
  if (!Number.isFinite(event.started_at_ms) || !Number.isFinite(event.duration_ms)) return null;
  const common = {
    event_id: typeof event.id === 'string' ? event.id.slice(0, 80) : null,
    parent_event_id:
      typeof event.parent_event_id === 'string' ? event.parent_event_id.slice(0, 80) : null,
    kind: event.kind,
    started_at_ms: event.started_at_ms,
    duration_ms: Math.max(0, Math.round(event.duration_ms * 1000) / 1000),
  };
  if (event.kind === 'database') {
    if (event.database !== 'node_sqlite' || !SQLITE_OPERATIONS.has(event.operation)) return null;
    return {
      ...common,
      database: 'node_sqlite',
      operation: event.operation,
      statement: normalizeSqlShape(event.statement),
      outcome: event.outcome === 'error' ? 'error' : 'ok',
    };
  }
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(event.method)) {
    return null;
  }
  if (
    typeof event.route !== 'string' ||
    !event.route.startsWith('/') ||
    event.route.includes('?')
  ) {
    return null;
  }
  return {
    ...common,
    method: event.method,
    route: event.route.slice(0, 256),
    status:
      Number.isInteger(event.status) && event.status >= 100 && event.status <= 599
        ? event.status
        : null,
    outcome: event.outcome === 'error' ? 'error' : 'ok',
  };
}

export function normalizeSqlShape(value) {
  if (typeof value !== 'string') return '<unknown>';
  return (
    value
      .replace(/--[^\r\n]*/g, ' ')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\b[xX]'(?:''|[^'])*'/g, '?')
      .replace(/'(?:''|[^'])*'/g, '?')
      .replace(/\b(?:0x[\da-f]+|\d+(?:\.\d+)?)\b/gi, '?')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 256) || '<empty>'
  );
}

function flowName(event) {
  if (event.kind === 'database') {
    return `SQLite ${event.operation.toUpperCase()} ${event.statement}`;
  }
  return `${event.method} ${event.route}`;
}

function flowAttributes(event) {
  if (event.kind === 'database') {
    return {
      database: event.database,
      operation: event.operation,
      statement: event.statement,
      outcome: event.outcome,
    };
  }
  return {
    method: event.method,
    route: event.route,
    status: event.status,
    outcome: event.outcome,
  };
}

function summarizeOperations(events) {
  const summaries = new Map();
  for (const event of events) {
    const key = event.kind === 'database' ? `${event.kind}:${event.operation}` : event.kind;
    const summary = summaries.get(key) ?? {
      kind: event.kind,
      ...(event.operation ? { operation: event.operation } : {}),
      count: 0,
      total_duration_ms: 0,
      max_duration_ms: 0,
    };
    summary.count += 1;
    summary.total_duration_ms += event.duration_ms;
    summary.max_duration_ms = Math.max(summary.max_duration_ms, event.duration_ms);
    summaries.set(key, summary);
  }
  return [...summaries.values()]
    .map((summary) => ({
      ...summary,
      total_duration_ms: roundMilliseconds(summary.total_duration_ms),
      max_duration_ms: roundMilliseconds(summary.max_duration_ms),
    }))
    .toSorted((left, right) => right.total_duration_ms - left.total_duration_ms);
}

function addTimingBreakdowns(flows) {
  for (const parent of flows.slice(1)) {
    const children = flows.filter(
      (flow) =>
        flow.parent_flow_id === parent.id &&
        flow.timing.provenance === parent.timing.provenance &&
        Number.isFinite(flow.timing.started_at_ms) &&
        Number.isFinite(flow.timing.duration_ms)
    );
    if (children.length === 0) continue;
    const parentStart = parent.timing.started_at_ms;
    const parentEnd = parentStart + parent.timing.duration_ms;
    const intervals = children
      .map((child) => [
        Math.max(parentStart, child.timing.started_at_ms),
        Math.min(parentEnd, child.timing.started_at_ms + child.timing.duration_ms),
      ])
      .filter(([start, end]) => end >= start)
      .toSorted((left, right) => left[0] - right[0]);
    let covered = 0;
    let current = null;
    for (const interval of intervals) {
      if (!current || interval[0] > current[1]) {
        if (current) covered += current[1] - current[0];
        current = [...interval];
      } else {
        current[1] = Math.max(current[1], interval[1]);
      }
    }
    if (current) covered += current[1] - current[0];
    parent.timing.accounting = {
      method: 'same_execution_child_interval_union',
      accounted_child_ms: roundMilliseconds(covered),
      unaccounted_ms: roundMilliseconds(Math.max(0, parent.timing.duration_ms - covered)),
    };
  }
}

function roundMilliseconds(value) {
  return Math.round(value * 1000) / 1000;
}

function emptyFlowEvidence(limitations = []) {
  return { files: 0, bytes: 0, events: [], truncated: false, limitations };
}
