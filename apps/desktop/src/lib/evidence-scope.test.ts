import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evidenceScopeNeedsValue,
  evidenceScopePlaceholder,
  evidenceScopePreviewPlan,
} from './evidence-scope';

test('scope intake distinguishes human/change input from whole-codebase discovery', () => {
  assert.equal(evidenceScopeNeedsValue('flow'), true);
  assert.equal(evidenceScopeNeedsValue('change'), true);
  assert.equal(evidenceScopeNeedsValue('codebase'), false);
  assert.match(evidenceScopePlaceholder('change'), /main\.\.HEAD/);
});

test('preview plan keeps evidence qualified and reusable across consumers', () => {
  const testing = evidenceScopePreviewPlan('testing');
  const performance = evidenceScopePreviewPlan('performance');
  assert.equal(testing.candidates[0].id, performance.candidates[0].id);
  assert.equal(testing.consumer, 'testing');
  assert.equal(performance.consumer, 'performance');
  assert.match(testing.limitations[0], /illustrative/i);
});
