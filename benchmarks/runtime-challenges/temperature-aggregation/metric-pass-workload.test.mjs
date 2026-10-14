import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';

import { aggregateTemperatures } from './parser.mjs';

test('temperature metric-pass workload', () => {
  const rows = 200_000;
  const input = 'Alpha;1.0\nBeta;-2.0\n'.repeat(rows / 2);
  const durations = [];
  for (let iteration = 0; iteration < 5; iteration += 1) {
    const start = performance.now();
    const result = aggregateTemperatures(input);
    durations.push(performance.now() - start);
    assert.deepEqual(result.get('Alpha'), {
      count: rows / 2,
      sum: 5 * rows,
      min: 10,
      max: 10,
    });
    assert.deepEqual(result.get('Beta'), {
      count: rows / 2,
      sum: -10 * rows,
      min: -20,
      max: -20,
    });
  }
  durations.sort((left, right) => left - right);
  console.log(`[benchmark] aggregate=${durations[2].toFixed(3)}ms/op (5 iterations)`);
});
