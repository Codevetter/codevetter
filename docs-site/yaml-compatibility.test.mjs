import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const matter = require('gray-matter');
const yamlRequire = createRequire(require.resolve('gray-matter'));
const yaml = yamlRequire('js-yaml');
const version = yamlRequire('js-yaml/package.json').version;
const cli = join(dirname(yamlRequire.resolve('js-yaml/package.json')), 'bin/js-yaml.js');

function run(args = [], input = '') {
  return spawnSync(process.execPath, [cli, ...args], {
    input,
    encoding: 'utf8',
    timeout: 10_000,
  });
}

test('frontmatter keeps nested YAML data', () => {
  assert.deepEqual(
    matter('---\ntitle: Verification\nsidebar:\n  order: 1\nflags: [a, b]\n---\nBody').data,
    { title: 'Verification', sidebar: { order: 1 }, flags: ['a', 'b'] }
  );
});

test('the legacy YAML CLI prints help and its package version', () => {
  const help = run(['--help']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /usage:/i);
  const result = run(['--version']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), version);
});

test('the YAML CLI converts stdin in both directions and supports multiple documents', () => {
  const expected = { title: 'Verification', items: ['a', 'b'] };
  const fromYaml = run([], 'title: Verification\nitems: [a, b]\n');
  assert.equal(fromYaml.status, 0, fromYaml.stderr);
  assert.deepEqual(JSON.parse(fromYaml.stdout), expected);
  const fromJson = run([], JSON.stringify(expected));
  assert.equal(fromJson.status, 0, fromJson.stderr);
  assert.deepEqual(yaml.safeLoad(fromJson.stdout), expected);
  const multiple = run([], '---\na: 1\n---\nb: 2\n');
  assert.equal(multiple.status, 0, multiple.stderr);
  assert.deepEqual(JSON.parse(multiple.stdout), [{ a: 1 }, { b: 2 }]);
});

test('the YAML CLI reports invalid input and unknown options', () => {
  for (const option of ['--compact', '--trace']) {
    const result = run([option], 'a: [\n');
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /YAMLException/);
  }
  const unknown = run(['--not-a-valid-option']);
  assert.equal(unknown.status, 2, unknown.stderr);
  assert.match(unknown.stderr, /unrecognized arguments/i);
});
