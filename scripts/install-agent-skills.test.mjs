import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { installAgentSkills, skillNames } from './install-agent-skills.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'codevetter-skills-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sourceRoot = join(root, 'source');
  const destination = join(root, 'installed');
  for (const name of skillNames) mkdirSync(join(sourceRoot, name), { recursive: true });
  return { sourceRoot, destination };
}

test('skill installation links canonical sources and repeats without changes', (t) => {
  const options = fixture(t);
  assert.equal(installAgentSkills(options).length, 4);
  for (const name of skillNames) {
    assert.equal(
      realpathSync(join(options.destination, name)),
      realpathSync(join(options.sourceRoot, name))
    );
  }
  assert.ok(installAgentSkills(options).every((plan) => plan.status === 'already_installed'));
});

test('collision preserves unrelated state and creates no partial skill links', (t) => {
  const options = fixture(t);
  mkdirSync(options.destination);
  const collision = join(options.destination, skillNames[3]);
  writeFileSync(collision, 'unrelated skill');
  assert.throws(() => installAgentSkills(options), /Existing skill preserved/);
  assert.equal(readFileSync(collision, 'utf8'), 'unrelated skill');
  assert.equal(existsSync(join(options.destination, skillNames[0])), false);
});
