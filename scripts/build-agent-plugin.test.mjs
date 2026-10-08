import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildAgentPlugin, runtimeFiles } from './build-agent-plugin.mjs';

const source = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'codevetter-plugin-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('relocated package boots its MCP server and has byte-identical allowlisted sources', (t) => {
  const root = fixture(t);
  const built = buildAgentPlugin({ output: join(root, 'market') });
  assert.equal(built.receipt.file_count, runtimeFiles.length + 4);
  for (const entry of built.receipt.files) {
    const bytes = readFileSync(join(built.plugin, entry.path));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
    const original = runtimeFiles.includes(entry.path)
      ? entry.path
      : `plugins/codevetter/${entry.path}`;
    assert.deepEqual(bytes, readFileSync(join(source, original)));
    if (entry.path.endsWith('.md')) {
      for (const match of bytes.toString().matchAll(/\]\(([^)]+)\)/g)) {
        if (match[1].startsWith('https:')) continue;
        assert.ok(existsSync(resolve(dirname(join(built.plugin, entry.path)), match[1])), match[1]);
      }
    }
  }
  const manifest = JSON.parse(readFileSync(join(built.plugin, '.codex-plugin/plugin.json')));
  const servers = JSON.parse(readFileSync(join(built.plugin, manifest.mcpServers)));
  const launch = servers.mcpServers.codevetter;
  const requests = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'list_invocations', arguments: {} },
    },
  ];
  const result = spawnSync(
    launch.command,
    [
      ...launch.args.map((arg) => arg.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, built.plugin)),
      '--ledger-dir',
      join(root, 'ledger'),
    ],
    {
      cwd: tmpdir(),
      input: `${requests.map((r) => JSON.stringify(r)).join('\n')}\n`,
      encoding: 'utf8',
      timeout: 5000,
    }
  );
  assert.equal(result.status, 0, result.stderr);
  const responses = result.stdout.trim().split('\n').map(JSON.parse);
  assert.equal(responses.length, 3);
  assert.equal(responses[1].result.tools.length, 5);
  assert.equal(JSON.parse(responses[2].result.content[0].text).total, 0);
  assert.equal(
    built.receipt.files.some((r) => /test_|node_modules|artifacts|__pycache__/.test(r.path)),
    false
  );
});

test('existing destinations and source symlinks are refused before writing files', (t) => {
  const root = fixture(t);
  const output = join(root, 'existing');
  mkdirSync(output);
  writeFileSync(join(output, 'owned'), 'keep');
  assert.throws(() => buildAgentPlugin({ output }), /EEXIST/);
  assert.deepEqual(readdirSync(output), ['owned']);
  const fake = join(root, 'source');
  mkdirSync(fake);
  cpSync(join(source, 'plugins'), join(fake, 'plugins'), { recursive: true });
  symlinkSync(join(source, 'skills'), join(fake, 'skills'), 'dir');
  const blocked = join(root, 'blocked');
  assert.throws(() => buildAgentPlugin({ output: blocked, sourceRoot: fake }), /symlink refused/);
  assert.equal(existsSync(blocked), false);
});
