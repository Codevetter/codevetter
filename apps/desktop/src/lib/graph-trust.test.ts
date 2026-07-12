import assert from 'node:assert/strict';
import test from 'node:test';

import {
  graphImportError,
  graphPathCandidateId,
  renderQualifiedGraphPath,
  selectActiveGraph,
} from './graph-trust';
import type { GraphPathResult, UnpackRepoGraph } from './tauri-ipc';

const savedGraph: UnpackRepoGraph = {
  schema_version: 2,
  nodes: [{ id: 'a', kind: 'file', label: 'A', sources: [] }],
  edges: [],
  truncated: false,
};

test('import preview never mutates or replaces the saved native graph', () => {
  const imported: UnpackRepoGraph = {
    schema_version: 2,
    nodes: [{ id: 'b', kind: 'concept', label: 'B', sources: [], community: '4' }],
    edges: [],
    truncated: false,
  };
  const active = selectActiveGraph(savedGraph, imported);
  assert.equal(active.graph, imported);
  assert.equal(active.imported, true);
  assert.deepEqual(
    savedGraph.nodes.map((node) => node.id),
    ['a']
  );
  assert.equal(selectActiveGraph(savedGraph, null).graph, savedGraph);
});

test('import errors remain actionable and local', () => {
  assert.equal(graphImportError(new Error('bad JSON')), 'Could not preview graph: bad JSON');
  assert.equal(
    graphImportError(new Error('TAURI_NOT_AVAILABLE')),
    'Graph import is available in the desktop app.'
  );
});

test('ambiguity exposes an explicit candidate instead of claiming a path', () => {
  const result: GraphPathResult = {
    source: {
      query: 'shared',
      status: 'ambiguous',
      selected: null,
      candidates: [{ id: 'a', label: 'A', kind: 'file', score: 200 }],
    },
    target: { query: 'b', status: 'not_found', selected: null, candidates: [] },
    hops: [],
    found: false,
    trust_summary: 'none',
    requires_verification: false,
    message: 'Select a candidate.',
    bounds: { max_hops: 8, max_visited_nodes: 5_000, visited_nodes: 0, truncated: false },
  };
  assert.equal(graphPathCandidateId(result, 'source'), 'a');
  assert.equal(graphPathCandidateId(result, 'target'), null);
});

test('path rendering qualifies uncertain hops as leads and never verified claims', () => {
  const result: GraphPathResult = {
    source: { query: 'A', status: 'resolved', selected: null, candidates: [] },
    target: { query: 'B', status: 'resolved', selected: null, candidates: [] },
    found: true,
    trust_summary: 'navigation_lead',
    requires_verification: true,
    message: 'found',
    bounds: { max_hops: 8, max_visited_nodes: 5000, visited_nodes: 2, truncated: false },
    hops: [
      {
        from: savedGraph.nodes[0],
        to: { id: 'b', kind: 'route', label: 'B', sources: [] },
        kind: 'routes_to',
        trust: 'inferred',
        origin: 'codevetter',
        evidence: 'file convention',
        sources: ['src/a.ts'],
        follows_stored_direction: true,
      },
    ],
  };
  const rendered = renderQualifiedGraphPath(result);
  assert.match(rendered, /Navigation lead only/);
  assert.match(rendered, /cannot establish a finding or verified claim/);
  assert.match(rendered, /src\/a.ts/);
});
