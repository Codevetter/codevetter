import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeUsagePaceLabel,
  resolveUsageWindowTotalSecs,
  USAGE_WINDOW_SECS,
} from '@/lib/usage-pace';

test('resolveUsageWindowTotalSecs uses provider-specific windows', () => {
  assert.equal(resolveUsageWindowTotalSecs('devin', 'primary'), USAGE_WINDOW_SECS.WEEK);
  assert.equal(resolveUsageWindowTotalSecs('devin', 'secondary'), USAGE_WINDOW_SECS.DAY);
  assert.equal(resolveUsageWindowTotalSecs('grok', 'primary'), undefined);
  assert.equal(resolveUsageWindowTotalSecs('anthropic', 'primary'), USAGE_WINDOW_SECS.FIVE_HOURS);
});

test('resolveUsageWindowTotalSecs prefers API window_total_secs', () => {
  assert.equal(resolveUsageWindowTotalSecs('anthropic', 'primary', 2_592_000), 2_592_000);
  assert.equal(resolveUsageWindowTotalSecs('grok', 'primary', 2_592_000), 2_592_000);
});

test('computeUsagePaceLabel projects monthly quota headroom correctly', () => {
  const month = USAGE_WINDOW_SECS.MONTH;
  const resetsIn = month / 2; // halfway through billing period
  const elapsed = month - resetsIn;
  const pct = 20;
  const projected = pct * (month / elapsed);
  const result = computeUsagePaceLabel(pct, month, resetsIn);
  assert.match(result.label ?? '', /headroom/);
  assert.equal(Math.round(100 - projected), 60);
});

test('computeUsagePaceLabel suppresses noisy early-window projections', () => {
  const result = computeUsagePaceLabel(0.2, USAGE_WINDOW_SECS.DAY, USAGE_WINDOW_SECS.DAY - 60);
  assert.equal(result.label, null);
});

test('computeUsagePaceLabel warns when projected to cap before reset', () => {
  const day = USAGE_WINDOW_SECS.DAY;
  const resetsIn = day * 0.25;
  const result = computeUsagePaceLabel(80, day, resetsIn);
  assert.match(result.label ?? '', /caps in|at limit/);
});
