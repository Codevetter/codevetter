import { resolve } from 'node:path';
import { tap } from 'node:test/reporters';
import { NODE_SELECTION_PREFIX, NODE_SELECTION_SCHEMA } from './node-test-selection.mjs';

const emptyCounts = () => ({ tests: 0, passed: 0, failed: 0, cancelled: 0, skipped: 0, todo: 0 });

// Keep Node's TAP renderer for metrics and failure frames. The final small
// record comes from runner events, not test stdout or parsed TAP prose.
export default async function* nodeTestReporter(source) {
  const scope = JSON.parse(process.env.CODEVETTER_NODE_TEST_SCOPE ?? 'null');
  const state = {
    scope,
    observed: emptyCounts(),
    matched: emptyCounts(),
    names: [],
    summary: null,
    fileSummary: null,
    fileSummaries: 0,
    valid: Boolean(scope && typeof scope.target === 'string'),
  };
  async function* events() {
    for await (const event of source) {
      if (event.type === 'test:start') recordName(state, event.data);
      if (['test:pass', 'test:fail'].includes(event.type)) recordResult(state, event);
      if (event.type === 'test:summary') recordSummary(state, event.data);
      yield event;
    }
  }
  yield* tap(events());
  const { observed, matched, summary, fileSummary, fileSummaries, valid } = state;
  const counts = summary?.counts ?? emptyCounts();
  const complete =
    valid &&
    fileSummaries === 1 &&
    Boolean(summary && fileSummary) &&
    Object.keys(observed).every((key) => counts[key] === fileSummary.counts?.[key]);
  yield `\n${NODE_SELECTION_PREFIX}${JSON.stringify({
    schema_version: NODE_SELECTION_SCHEMA,
    target: scope?.target ?? null,
    name: scope?.name ?? null,
    complete,
    success: summary?.success === true,
    counts,
    observed,
    matched,
  })}\n`;
}

function recordName(state, data) {
  if (
    !Number.isSafeInteger(data.nesting) ||
    data.nesting < 0 ||
    data.nesting > 32 ||
    typeof data.name !== 'string' ||
    data.name.length > 1024
  ) {
    state.valid = false;
    return;
  }
  state.names[data.nesting] = data.name;
  state.names.length = data.nesting + 1;
}

function recordResult(state, { type, data }) {
  if (data.details?.type === 'suite') return;
  const kind = resultKind(type, data);
  state.observed.tests++;
  state.observed[kind]++;
  const fullName = [...state.names.slice(0, data.nesting), data.name].join(' ');
  const name = state.scope?.name;
  if (name === null || data.name === name || fullName === name) {
    state.matched.tests++;
    state.matched[kind]++;
  }
}

function resultKind(type, data) {
  const present = (value) => value !== undefined && value !== false;
  if (present(data.skip)) return 'skipped';
  if (present(data.todo)) return 'todo';
  if (type === 'test:pass') return 'passed';
  if (data.details?.error?.failureType === 'cancelledByParent') return 'cancelled';
  return 'failed';
}

function recordSummary(state, data) {
  if (data.file === undefined) {
    state.summary = data;
    return;
  }
  state.fileSummaries++;
  state.fileSummary = data;
  if (!state.valid || resolve(data.file) !== resolve(state.scope.target)) state.valid = false;
}
