// Chromium-only probe for an asserted, same-document Playwright interaction.
const METRICS = {
  TaskDuration: 'task',
  ScriptDuration: 'script',
  LayoutDuration: 'layout',
  RecalcStyleDuration: 'style',
};

export async function measureBrowserInteraction(
  page,
  label,
  action,
  { cpuRate = 1, cpuProfile = false } = {}
) {
  if (!/^[a-z][\w-]*$/.test(label)) throw new Error('Expected a lowercase workload label.');
  if (!Number.isFinite(cpuRate) || cpuRate < 1)
    throw new Error('Expected a CPU throttle rate of at least 1.');
  const session = await page.context().newCDPSession(page);
  let frameProbeStarted = false;
  let profilerStarted = false;
  const restore = async () => {
    if (frameProbeStarted) await page.evaluate(stopFrameProbe, label).catch(() => {});
    const cleanup = await Promise.allSettled([
      profilerStarted ? session.send('Profiler.stop') : undefined,
      session.send('Emulation.setCPUThrottlingRate', { rate: 1 }),
    ]);
    await session.detach();
    const rejected = cleanup.find((result) => result.status === 'rejected');
    if (rejected) throw rejected.reason;
  };
  let result;
  try {
    await session.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
    await session.send('Performance.enable');
    if (cpuProfile) {
      await session.send('Profiler.enable');
      await session.send('Profiler.start');
      profilerStarted = true;
    }
    await page.evaluate(startFrameProbe, label);
    frameProbeStarted = true;
    const before = await session.send('Performance.getMetrics');
    await action();
    const after = await session.send('Performance.getMetrics');
    const intervals = await page.evaluate(stopFrameProbe, label);
    frameProbeStarted = false;
    const profile = cpuProfile ? (await session.send('Profiler.stop')).profile : undefined;
    profilerStarted = false;
    const metrics = browserInteractionMetrics(before.metrics, after.metrics, intervals);
    result = { metrics, benchmark: cpuProfile ? null : formatBenchmark(label, metrics), profile };
  } catch (error) {
    await restore().catch(() => {});
    throw error;
  }
  await restore();
  return result;
}

function formatBenchmark(label, metrics) {
  const values = Object.entries(metrics)
    .map(([name, { value, unit }]) => `${label}.${name}=${value.toFixed(3)}${unit}`)
    .join(' ');
  return `[benchmark] ${values}`;
}

// These functions execute in the page and cannot close over module state.
function startFrameProbe(label) {
  const key = Symbol.for(`codevetter.frames.${label}`);
  if (globalThis[key]) throw new Error('Browser frame probe already active.');
  const state = { intervals: [], previous: undefined, frame: 0, overflowed: false };
  globalThis[key] = state;
  const record = (now) => {
    if (state.previous !== undefined) state.intervals.push(now - state.previous);
    if (state.intervals.length >= 7200) {
      state.overflowed = true;
      return;
    }
    state.previous = now;
    state.frame = requestAnimationFrame(record);
  };
  state.frame = requestAnimationFrame(record);
}

function stopFrameProbe(label) {
  const key = Symbol.for(`codevetter.frames.${label}`);
  const state = globalThis[key];
  if (!state) throw new Error('Browser frame probe lost its document.');
  cancelAnimationFrame(state.frame);
  delete globalThis[key];
  if (state.overflowed) throw new Error('Browser frame probe exceeded its sample bound.');
  return state.intervals;
}

export function browserInteractionMetrics(before, after, intervals) {
  if (!intervals.length)
    throw new Error('No animation frame intervals observed during the interaction.');
  const metrics = {};
  const start = new Map(before.map(({ name, value }) => [name, value]));
  const end = new Map(after.map(({ name, value }) => [name, value]));
  for (const [name, metric] of Object.entries(METRICS)) {
    const delta = (end.get(name) - start.get(name)) * 1000;
    if (!Number.isFinite(delta) || delta < 0)
      throw new Error(`Invalid Chromium performance delta for ${name}.`);
    metrics[metric] = { value: delta, unit: 'ms' };
  }
  const sorted = intervals.slice().sort((a, b) => a - b);
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
  return {
    ...metrics,
    'frame-count': { value: intervals.length, unit: 'count' },
    'raf-p95': { value: p95, unit: 'ms' },
    'raf-over-50ms': { value: intervals.filter((interval) => interval > 50).length, unit: 'count' },
  };
}
