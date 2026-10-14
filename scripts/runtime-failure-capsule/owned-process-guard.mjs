// Private IPC launcher: never executes project JS in this event loop and never
// joins another group. Project processes receive no control channel to the guard.
import { spawn } from 'node:child_process';

let child;
let stopping = false;
let reported = false;
const killGroup = () => process.kill(-process.pid, 'SIGKILL');
const report = (code, signal, error = null) => {
  if (reported) return;
  reported = true;
  if (!process.connected) return killGroup();
  process.send({ type: 'outcome', code, signal, error }, () => killGroup());
};
const shutdown = (signal) => {
  if (stopping) return;
  stopping = true;
  process.kill(-process.pid, signal);
  setTimeout(() => report(null, 'SIGKILL'), 500);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
// Includes abrupt death of a diagnostic parent owning a nested detached guard.
process.once('disconnect', killGroup);
process.once('message', ({ program, args, environment }) => {
  if (stopping) return;
  child = spawn(program, args, {
    env: environment,
    shell: false,
    detached: false,
    stdio: ['ignore', 1, 2],
  });
  child.once('error', (error) => report(null, null, error.message));
  child.once('exit', (code, signal) => report(code, signal));
});
