import { lstat, readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { repositoryRelative } from './contracts.mjs';
import {
  assertRunId,
  assertSupervisedRunReceipt,
  SUPERVISION_LIMITS,
} from './supervision-contracts.mjs';

// Private supervisor-to-diagnostic context. The workload's minimal environment
// does not forward this variable. Ordinary plans have no output exemptions.
export const SUPERVISION_INPUT_ENV = 'CODEVETTER_OWNED_RUN_DIRECTORY';
const PREFIX = '.codevetter/performance-runs/';
const OUTPUT = /^(?:receipt|result)\.json(?:\.codevetter-\d+-\d+\.tmp)?$/;

export async function ownedSupervisionInputs(root, explicitDirectory) {
  const directory =
    explicitDirectory === undefined
      ? (process.env[SUPERVISION_INPUT_ENV] ?? null)
      : explicitDirectory;
  if (directory === null) return null;
  if (typeof directory !== 'string' || !directory.startsWith(PREFIX))
    throw new Error('invalid owned supervisor input context');
  const runId = assertRunId(directory.slice(PREFIX.length));
  if (explicitDirectory === undefined) await verifyParentReceipt(root, directory, runId);
  return directory;
}

export function isOwnedSupervisionOutput(entry, directory) {
  if (!directory || !entry.startsWith(`? ${directory}/`)) return false;
  return OUTPUT.test(entry.slice(directory.length + 3));
}

async function verifyParentReceipt(root, directory, runId) {
  const canonicalRoot = await realpath(resolve(root));
  const ownedDirectory = await realpath(resolve(canonicalRoot, directory));
  if (repositoryRelative(canonicalRoot, ownedDirectory) === null)
    throw new Error('owned supervisor input context escapes repository');
  const path = resolve(ownedDirectory, 'receipt.json');
  // onStarted atomically records the child's identity after spawn. Fail closed
  // if the private context cannot be bound to this diagnostic and its parent.
  for (let attempt = 0; attempt < 100; attempt++) {
    const info = await lstat(path);
    if (!info.isFile() || info.size > SUPERVISION_LIMITS.receiptBytes)
      throw new Error('invalid owned supervisor receipt');
    const receipt = assertSupervisedRunReceipt(JSON.parse(await readFile(path, 'utf8')));
    if (receipt.run_id !== runId || receipt.supervisor.pid !== process.ppid)
      throw new Error('owned supervisor receipt does not match parent');
    if (receipt.state === 'running' && receipt.child.pid === process.pid) return;
    if (receipt.state !== 'initialized') break;
    await delay(10);
  }
  throw new Error('owned supervisor receipt does not match diagnostic');
}
