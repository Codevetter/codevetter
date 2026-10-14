export const consumerFixtures = {
  'study/setup.ts': `import { afterEach, expect } from 'vitest';
import { readFileSync } from 'node:fs';
afterEach(({ task }) => {
 task.meta.studyAssertions = expect.getState().assertionCalls;
 task.meta.studyRunId = JSON.parse(readFileSync('study/run.json', 'utf8')).runId;
});`,
  'src/study-counter.ts': 'let calls = 0; export const next = () => ++calls;',
  'src/study-reset.test.ts': `import { it, expect, vi, afterEach, inject } from 'vitest';
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('resets module state explicitly', async () => {
 vi.resetModules(); expect((await import('./study-counter')).next()).toBe(1);
 vi.resetModules(); expect((await import('./study-counter')).next()).toBe(1);
});
it('resets fake timers and globals explicitly', () => {
 vi.useFakeTimers(); const callback = vi.fn(); setTimeout(callback, 100);
 vi.advanceTimersByTime(100); expect(callback).toHaveBeenCalledTimes(1);
 vi.useRealTimers(); expect(vi.isFakeTimers()).toBe(false);
 vi.stubGlobal('studyValue', 3); expect(globalThis.studyValue).toBe(3);
 vi.unstubAllGlobals(); expect('studyValue' in globalThis).toBe(false);
});
it('restores spy implementations', () => {
 const source = { value: () => 1 }; vi.spyOn(source, 'value').mockReturnValue(2);
 expect(source.value()).toBe(2); vi.restoreAllMocks(); expect(source.value()).toBe(1);
});
it('observes the configured environment', () => {
 expect(typeof document).toBe(inject('studyEnvironment') === 'node' ? 'undefined' : 'object');
});`,
  'src/study-leak.test.ts': `import { it, expect } from 'vitest';
import { next } from './study-counter';
it('initial singleton', () => expect(next()).toBe(1));
it('unreset singleton counterexample', () => expect(next()).toBe(1));`,
  'src/study-hook.test.ts': `import { it, expect, afterAll } from 'vitest';
it('body before hook failure', () => expect(1).toBe(1));
afterAll(() => { throw new Error('seeded afterAll failure'); });`,
  'src/study-cancel.test.ts': `import { it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
it('active body', async () => {
 writeFileSync('study/started', JSON.stringify({pid: process.pid}));
 await new Promise(resolve => setTimeout(resolve, 500));
 writeFileSync('study/completed', 'completed'); expect(1).toBe(1);
});
it('queued body', () => { writeFileSync('study/queued', 'queued'); expect(1).toBe(1); });`,
};
