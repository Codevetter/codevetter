import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { graphFromImpactRaw, hitsFromQueryRaw } from './deep-graph-parse';

describe('deep-graph-parse', () => {
  it('parses query hits from results array', () => {
    const hits = hitsFromQueryRaw({
      results: [
        { name: 'validateUser', kind: 'Function', filePath: 'src/auth.ts', score: 0.92 },
        { name: 'login', kind: 'Function', file_path: 'src/routes/login.ts' },
      ],
    });
    assert.equal(hits.length, 2);
    assert.equal(hits[0]?.name, 'validateUser');
    assert.equal(hits[0]?.path, 'src/auth.ts');
  });

  it('builds impact graph with depth layers', () => {
    const graph = graphFromImpactRaw({
      symbol: { name: 'validateUser', kind: 'Function', filePath: 'src/auth.ts' },
      upstream: {
        depth_1: [{ name: 'login', kind: 'Function', filePath: 'src/routes/login.ts' }],
        depth_2: [{ name: 'app', kind: 'Function', filePath: 'src/app.ts' }],
      },
      summary: { risk_level: 'medium', changed_count: 2 },
    });
    assert.ok(graph.nodes.length >= 3);
    assert.ok(graph.edges.length >= 2);
    assert.equal(graph.nodes[0]?.label, 'validateUser');
  });
});
