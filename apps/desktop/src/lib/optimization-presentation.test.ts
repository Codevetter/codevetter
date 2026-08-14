import assert from 'node:assert/strict';
import test from 'node:test';

import type { PerformanceLabReceipt } from '@/lib/tauri-ipc';
import {
  humanizeLabToken,
  labOutcomeCopy,
  performanceChangeCost,
  performanceSummaryMetrics,
} from '@/lib/optimization-presentation';

test('performance summary keeps only known finite evidence metrics', () => {
  assert.deepEqual(
    performanceSummaryMetrics({
      discovered_flows: 7,
      browser_traced_flows: 2,
      candidate_ready_flows: null,
      invented_metric: 999,
    }),
    [
      { key: 'discovered_flows', label: 'Flows found', value: 7 },
      { key: 'browser_traced_flows', label: 'Browser traces', value: 2 },
    ]
  );
});

test('incomplete receipts do not invent a performance decision', () => {
  const receipt = {
    state: 'running',
    stop: null,
    acceptance: null,
  } as PerformanceLabReceipt;
  assert.deepEqual(labOutcomeCopy(receipt), {
    eyebrow: 'Incomplete receipt',
    title: 'No terminal performance decision was recorded',
    tone: 'attention',
  });
});

test('source-edit stop is presented as a handoff rather than an optimization claim', () => {
  const receipt = {
    state: 'stopped',
    stop: { kind: 'source_edit_required', reason: 'Candidate found.' },
    acceptance: null,
  } as PerformanceLabReceipt;
  assert.deepEqual(labOutcomeCopy(receipt), {
    eyebrow: 'Agent handoff ready',
    title: 'A source-bounded candidate was found',
    tone: 'attention',
  });
});

test('accepted receipts expose patch cost without inventing missing values', () => {
  const receipt = {
    acceptance: {
      change_cost: {
        observed: {
          files_changed: 2,
          lines_added: 60,
          lines_removed: 2,
          gross_lines_changed: 62,
          production_dependencies_added: [],
        },
        violations: [],
      },
    },
  } as unknown as PerformanceLabReceipt;

  assert.deepEqual(performanceChangeCost(receipt), {
    files: 2,
    added: 60,
    removed: 2,
    gross: 62,
    dependenciesAdded: 0,
    violations: [],
  });
  assert.equal(performanceChangeCost({ acceptance: null } as PerformanceLabReceipt), null);
});

test('machine tokens become readable labels', () => {
  assert.equal(humanizeLabToken('browser_server_blocked'), 'Browser server blocked');
});
