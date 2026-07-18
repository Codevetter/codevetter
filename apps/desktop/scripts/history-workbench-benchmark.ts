import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';

import { deriveHistoryGraphTransition, filterHistoryRevisions } from '../src/lib/history-workbench';
import type { HistoryRevision, UnpackRepoGraph } from '../src/lib/tauri-ipc';

const percentile = (samples: number[], value: number) => {
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.floor((ordered.length - 1) * value)];
};

const graph = (revision: number, changedEvery: number): UnpackRepoGraph => {
  const nodes = Array.from({ length: 1_500 }, (_, index) => ({
    id: `node-${index}`,
    kind: index % 7 === 0 ? 'function' : 'file',
    label: `Entity ${index}`,
    path: `src/unit-${index % 240}/file-${index}.ts`,
    detail: index % changedEvery === 0 ? `revision ${revision}` : 'stable',
    sources: [`src/unit-${index % 240}/file-${index}.ts`],
  }));
  const edges = Array.from({ length: 2_200 }, (_, index) => ({
    from: `node-${index % nodes.length}`,
    to: `node-${(index * 17 + 11) % nodes.length}`,
    kind: index % 5 === 0 ? 'calls' : 'contains',
    evidence: 'benchmark edge',
    sources: [],
  }));
  return { schema_version: 3, nodes, edges, truncated: false };
};

const revisions: HistoryRevision[] = Array.from({ length: 2_000 }, (_, index) => ({
  sha: `${index.toString(16).padStart(40, '0')}`,
  short_sha: index.toString(16).padStart(8, '0'),
  parents: index === 0 ? [] : [(index - 1).toString(16).padStart(40, '0')],
  committed_at: new Date(Date.UTC(2020, 0, 1 + index)).toISOString(),
  author: `Author ${index % 12}`,
  subject: index % 47 === 0 ? `release analytics ${index}` : `change unit ${index}`,
  tags: index % 47 === 0 ? [`v1.${Math.floor(index / 47)}.0`] : [],
  is_release: index % 47 === 0,
  is_head: index === 1_999,
}));

const before = graph(1, 23);
const after = graph(2, 23);
const transitionSamples: number[] = [];
for (let index = 0; index < 500; index += 1) {
  const started = performance.now();
  deriveHistoryGraphTransition(index % 2 === 0 ? before : after, index % 2 === 0 ? after : before);
  transitionSamples.push(performance.now() - started);
}

const searchSamples: number[] = [];
for (let index = 0; index < 500; index += 1) {
  const started = performance.now();
  filterHistoryRevisions(revisions, index % 2 === 0 ? 'analytics' : 'Author 7', index % 3 === 0);
  searchSamples.push(performance.now() - started);
}

const memory = process.memoryUsage();
const transitionP50 = percentile(transitionSamples, 0.5);
const transitionP95 = percentile(transitionSamples, 0.95);
const searchP50 = percentile(searchSamples, 0.5);
const searchP95 = percentile(searchSamples, 0.95);
const heapMiB = memory.heapUsed / 1_048_576;
console.log('=== history workbench data-path benchmark ===');
console.log('graph: 1,500 nodes · 2,200 edges · 500 transitions');
console.log(`transition p50/p95: ${transitionP50.toFixed(3)} / ${transitionP95.toFixed(3)} ms`);
console.log('history: 2,000 revisions · 500 bounded searches');
console.log(`search p50/p95: ${searchP50.toFixed(3)} / ${searchP95.toFixed(3)} ms`);
console.log(`frame budget: ${(1000 / 60).toFixed(2)} ms at 60 Hz`);
console.log(`heap used: ${heapMiB.toFixed(1)} MiB`);

assert.ok(transitionP95 <= 8, `transition p95 ${transitionP95.toFixed(3)} ms exceeds 8 ms`);
assert.ok(searchP95 <= 4, `search p95 ${searchP95.toFixed(3)} ms exceeds 4 ms`);
assert.ok(heapMiB <= 64, `heap ${heapMiB.toFixed(1)} MiB exceeds 64 MiB`);
