#!/usr/bin/env node

import { availableParallelism, totalmem } from 'node:os';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { build } from 'vite';

const forwardedArgs = process.argv.slice(2);
const configuredWorkers = Number.parseInt(process.env.CODEVETTER_E2E_WORKERS ?? '', 10);
const memoryBoundWorkers = Math.max(2, Math.floor(totalmem() / (2 * 1024 ** 3)));
const workers =
  Number.isInteger(configuredWorkers) && configuredWorkers > 0
    ? configuredWorkers
    : Math.max(2, Math.min(16, availableParallelism() - 2, memoryBoundWorkers));
const hasWorkerOverride = forwardedArgs.some(
  (argument) => argument === '--workers' || argument.startsWith('--workers=')
);
const hasTraceOverride = forwardedArgs.some(
  (argument) => argument === '--trace' || argument.startsWith('--trace=')
);

await build({ logLevel: 'warn' });

const browserServer = await chromium.launchServer({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined,
});

const runnerArgs = ['exec', 'playwright', 'test', '--fully-parallel'];
if (!hasWorkerOverride) runnerArgs.push(`--workers=${workers}`);
runnerArgs.push(...forwardedArgs);

let forwardedSignal;
let activeRunner;
const forwardSignal = (signal) => {
  forwardedSignal = signal;
  activeRunner?.kill(signal);
};
process.once('SIGINT', forwardSignal);
process.once('SIGTERM', forwardSignal);

let exitCode;
try {
  exitCode = await runPlaywright(runnerArgs);
  if (exitCode !== 0 && !forwardedSignal && !hasTraceOverride) {
    process.stderr.write('\nFast run failed; rerunning only failures with tracing enabled.\n');
    await runPlaywright([
      'exec',
      'playwright',
      'test',
      '--last-failed',
      '--workers=1',
      '--trace=retain-on-failure',
      '--reporter=line',
    ]);
  }
} finally {
  process.removeListener('SIGINT', forwardSignal);
  process.removeListener('SIGTERM', forwardSignal);
  await browserServer.close();
}

process.exitCode = exitCode;

function runPlaywright(args) {
  activeRunner = spawn('pnpm', args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODEVETTER_E2E_FAST: '1',
      CODEVETTER_E2E_PREVIEW: '1',
      PW_TEST_CONNECT_WS_ENDPOINT: browserServer.wsEndpoint(),
    },
    stdio: 'inherit',
  });

  return new Promise((resolve, reject) => {
    activeRunner.once('error', reject);
    activeRunner.once('exit', (code, signal) => {
      activeRunner = undefined;
      if (signal && !forwardedSignal) {
        reject(new Error(`Playwright runner exited from ${signal}`));
        return;
      }
      resolve(code ?? (signal ? 1 : 0));
    });
  });
}
