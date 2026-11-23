import assert from 'node:assert/strict';
import test from 'node:test';
import { browserInteractionMetrics, measureBrowserInteraction } from './browser-interaction.mjs';

const counters = (value) =>
  ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration'].map((name) => ({
    name,
    value,
  }));

test('summarizes renderer deltas and frame intervals', () => {
  const observed = browserInteractionMetrics(counters(0), counters(0.125), [
    ...Array(18).fill(16),
    51,
    100,
  ]);
  assert.deepEqual(observed.task, { value: 125, unit: 'ms' });
  assert.deepEqual(observed['raf-p95'], { value: 51, unit: 'ms' });
  assert.deepEqual(observed['raf-over-50ms'], { value: 2, unit: 'count' });
  assert.throws(
    () => browserInteractionMetrics(counters(1), counters(0), [16]),
    /Invalid Chromium/
  );
  assert.throws(
    () => browserInteractionMetrics(counters(0), counters(1), []),
    /No animation frame/
  );
});

test('cleans up the frame probe, CPU throttle, and session after an action fails', async () => {
  const commands = [];
  const page = {
    context: () => ({
      newCDPSession: async () => ({
        send: async (method, args) => {
          commands.push([method, args]);
          if (method === 'Emulation.setCPUThrottlingRate' && args.rate === 1) {
            throw new Error('Target closed');
          }
          return { metrics: counters(0) };
        },
        detach: async () => commands.push(['detach']),
      }),
    }),
    evaluate: async (probe) => commands.push([probe.name]),
  };
  await assert.rejects(
    measureBrowserInteraction(
      page,
      'chart',
      async () => {
        throw new Error('assertion failed');
      },
      { cpuRate: 4, cpuProfile: true }
    ),
    /assertion failed/
  );
  assert.deepEqual(commands.slice(-4), [
    ['stopFrameProbe'],
    ['Profiler.stop', undefined],
    ['Emulation.setCPUThrottlingRate', { rate: 1 }],
    ['detach'],
  ]);
});
