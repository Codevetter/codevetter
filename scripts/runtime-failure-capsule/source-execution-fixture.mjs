// Synthetic fixture material shared by the executable study and its regressions.
export const typedSource = `enum Mode { Bounded, Full }
export function choose(values: number[], mode: Mode): number[] {
  if (mode === Mode.Full) {
    return values.sort((a, b) => a - b);
  }
  return values.slice(0, 1);
}
`;

export const captureSource = `import assert from 'node:assert/strict';
import { Session } from 'node:inspector/promises';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const identity = JSON.parse(await readFile(new URL('./identity.json', import.meta.url)));
const session = new Session(); session.connect();
await session.post('Debugger.enable');
await session.post('Profiler.enable');
await session.post('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
const { choose } = await import('./generated.mjs');
const mode = identity.mode;
identity.runtime = process.version;
identity.node_binary_sha256 = createHash('sha256').update(await readFile(process.execPath)).digest('hex');
identity.selection_sha256 = createHash('sha256').update(JSON.stringify({input: [3, 1, 2], mode})).digest('hex');
assert.deepEqual(choose([3, 1, 2], mode), mode === 0 ? [3] : [1, 2, 3]);
const { result } = await session.post('Profiler.takePreciseCoverage');
const script = result.find(entry => entry.url === new URL('./generated.mjs', import.meta.url).href);
assert.ok(script);
const { scriptSource } = await session.post('Debugger.getScriptSource', { scriptId: script.scriptId });
await session.post('Profiler.stopPreciseCoverage'); session.disconnect();
console.log(JSON.stringify({identity, status: 'completed', selected_tests: 1, executed_tests: 1,
 errors: 0, functions: script.functions,
 executed_source_sha256: createHash('sha256').update(scriptSource).digest('hex')}));
`;
