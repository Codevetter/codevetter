import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The guard is the live POSIX group leader. Only it escalates to SIGKILL, so
// delayed cleanup cannot target a recycled group ID after the leader exits.
export function spawnOwnedProcess(program, args, options) {
  if (process.platform === 'win32') return spawn(program, args, options);
  const env = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP'])
    if (options.env[key] !== undefined) env[key] = options.env[key];
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL('./owned-process-guard.mjs', import.meta.url))],
    {
      cwd: options.cwd,
      env,
      shell: false,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    }
  );
  child.on('message', (message) => {
    if (message?.type === 'outcome') child.ownedOutcome = message;
  });
  child.once('spawn', () => {
    child.send({ program, args, environment: options.env }, () => {});
  });
  return child;
}

export function terminateOwnedProcess(child, signal) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  // Signal the live ChildProcess, never a persisted PID supplied by a receipt.
  child.kill(signal);
}

export function ownedProcessOutcome(child, code, signal) {
  return child.ownedOutcome ?? { code, signal };
}
