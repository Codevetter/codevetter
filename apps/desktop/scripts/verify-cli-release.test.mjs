import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { qualifyCli } from './verify-cli-release.mjs';

const TRACKED_VERSION = JSON.parse(
  readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8')
).version;
const HELP = `CodeVetter execution-backed verification

Usage:
  codevetter check (--pr <url> | --range <base..head>) --task <text> [options]
  codevetter trex (--pr <url> | --range <base..head>) --preview <url> [--repo <path>] [--json]

Options:
  --pr <url>
  --range <range>
  --preview <url>
  --repo <path>
  --task <text>
  --preflight
  --spec <path>
  --requirement <id>
  --baseline-repo <path>
  --json
`;

async function fakeCli(directory, { version = TRACKED_VERSION, help = HELP } = {}) {
  const path = join(directory, 'codevetter');
  await writeFile(
    path,
    `#!/usr/bin/env node
const argument = process.argv[2];
if (argument === '--version') process.stdout.write('codevetter ${version}\\n');
else if (argument === '--help') process.stdout.write(${JSON.stringify(help)});
else process.exitCode = 2;
`
  );
  await chmod(path, 0o755);
  return path;
}

test('qualifies the tracked version, help surface, and bundle declarations', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'codevetter-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const binaryPath = await fakeCli(directory);

  const result = qualifyCli({ binaryPath });

  assert.equal(result.version, TRACKED_VERSION);
  assert.equal(result.bundleEntry, 'binaries/codevetter');
  assert.equal(result.helpContracts, 12);
  assert.ok(result.bytes > 0);
});

test('fails on version drift', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'codevetter-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const binaryPath = await fakeCli(directory, { version: '0.0.0-drift' });

  assert.throws(
    () => qualifyCli({ binaryPath }),
    (error) => {
      assert.match(error.message, /CLI version mismatch/);
      assert.match(
        error.message,
        new RegExp(`codevetter ${TRACKED_VERSION.replaceAll('.', '\\.')}`)
      );
      assert.match(error.message, /codevetter 0\.0\.0-drift/);
      return true;
    }
  );
});

test('fails when a documented T-Rex flag disappears', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'codevetter-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const binaryPath = await fakeCli(directory, {
    help: HELP.replaceAll('--json', '--machine'),
  });

  assert.throws(() => qualifyCli({ binaryPath }), /CLI help is missing required contract: --json/);
});

test('fails when the spec verification contract disappears', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'codevetter-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const binaryPath = await fakeCli(directory, {
    help: HELP.replace('--requirement <id>', '--criterion <id>'),
  });

  assert.throws(
    () => qualifyCli({ binaryPath }),
    /CLI help is missing required contract: --requirement <id>/
  );
});

test('fails when the preflight contract disappears', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'codevetter-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const binaryPath = await fakeCli(directory, {
    help: HELP.replace('--preflight', '--execute-only'),
  });

  assert.throws(
    () => qualifyCli({ binaryPath }),
    /CLI help is missing required contract: --preflight/
  );
});

test('fails when either Tauri bundle declaration drops the CLI', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'codevetter-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const binaryPath = await fakeCli(directory);
  const projectRoot = join(directory, 'desktop');
  const tauriRoot = join(projectRoot, 'src-tauri');
  await mkdir(tauriRoot, { recursive: true });
  await writeFile(
    join(tauriRoot, 'tauri.conf.json'),
    JSON.stringify({
      version: TRACKED_VERSION,
      bundle: { externalBin: ['binaries/codevetter'] },
    })
  );
  await writeFile(
    join(tauriRoot, 'tauri.macos.conf.json'),
    JSON.stringify({
      bundle: { externalBin: ['binaries/codevetter-mcp'] },
    })
  );

  assert.throws(
    () => qualifyCli({ binaryPath, projectRoot }),
    /tauri\.macos\.conf\.json does not declare binaries\/codevetter/
  );
});
