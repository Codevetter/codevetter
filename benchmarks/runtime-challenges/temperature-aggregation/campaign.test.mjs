import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeSamples } from './campaign.mjs';

test('campaign discards timing extrema before calculating the retained mean', () => {
  assert.deepEqual(summarizeSamples([30, 10, 20, 50, 40]), {
    minimum: 10,
    maximum: 50,
    retained_mean: 30,
  });
});
