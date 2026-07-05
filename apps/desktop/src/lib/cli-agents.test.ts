import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  COMMAND_CODE_DEFAULT_MODEL,
  COMMAND_CODE_MODEL_CATALOG,
  commandCodeModelGroups,
  formatUnpackError,
  mergeCommandCodeModels,
} from '@/lib/cli-agents';

describe('formatUnpackError', () => {
  it('surfaces the backend message and agent context', () => {
    const out = formatUnpackError(
      new Error('claude failed (resolved to /usr/local/bin/claude):\nnot logged in'),
      'claude',
      'sonnet'
    );
    assert.match(out, /not logged in/);
    assert.match(out, /Claude \(CLI\)/);
    assert.match(out, /model sonnet/);
    assert.match(out, /Authenticate/i);
  });

  it('adds install hint for spawn failures', () => {
    const out = formatUnpackError('Failed to spawn grok: No such file', 'grok');
    assert.match(out, /on PATH/i);
  });

  it('adds retry hint for sqlite lock contention', () => {
    const out = formatUnpackError('database is locked', 'command-code', 'deepseek/deepseek-v4-pro');
    assert.match(out, /database was busy/i);
    assert.match(out, /retry Generate Brief/i);
  });
});

describe('COMMAND_CODE_MODEL_CATALOG', () => {
  it('lists all 35 Command Code models in five provider groups', () => {
    assert.equal(COMMAND_CODE_MODEL_CATALOG.length, 35);
    const groups = commandCodeModelGroups();
    assert.equal(groups.length, 5);
    assert.equal(groups.find((g) => g.group === 'Open Source')?.models.length, 22);
    assert.equal(groups.find((g) => g.group === 'Anthropic')?.models.length, 6);
    assert.equal(groups.find((g) => g.group === 'OpenAI')?.models.length, 4);
    assert.equal(groups.find((g) => g.group === 'Google')?.models.length, 2);
    assert.equal(groups.find((g) => g.group === 'Sakana')?.models.length, 1);
  });

  it('marks the CLI default model', () => {
    const row = COMMAND_CODE_MODEL_CATALOG.find((m) => m.id === COMMAND_CODE_DEFAULT_MODEL);
    assert.ok(row?.isDefault);
  });

  it('merges live CLI models without dropping catalog entries', () => {
    const merged = mergeCommandCodeModels([
      {
        id: 'future/vendor-model',
        description: 'new model from CLI',
        group: 'Other',
      },
    ]);
    assert.equal(merged.length, 36);
    assert.ok(merged.some((m) => m.id === 'future/vendor-model'));
    assert.ok(merged.some((m) => m.id === 'claude-sonnet-5'));
  });
});
