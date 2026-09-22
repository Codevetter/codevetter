import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeBiomeSarif } from './run-biome-sarif.mjs';

test('normalizes empty Biome rule metadata and result messages for GitHub', () => {
  const sarif = normalizeBiomeSarif({
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'Biome',
            rules: [
              {
                id: 'ci',
                shortDescription: { text: '' },
                helpUri: '',
              },
            ],
          },
        },
        results: [
          {
            ruleId: 'ci',
            message: { text: '' },
          },
        ],
      },
    ],
  });

  const [rule] = sarif.runs[0].tool.driver.rules;
  assert.deepEqual(rule.shortDescription, { text: 'ci' });
  assert.equal('helpUri' in rule, false);
  assert.deepEqual(sarif.runs[0].results[0].message, {
    text: 'Biome reported ci.',
  });
});

test('preserves populated Biome SARIF fields', () => {
  const sarif = normalizeBiomeSarif({
    runs: [
      {
        tool: {
          driver: {
            rules: [
              {
                id: 'lint/correctness/noUnusedVariables',
                shortDescription: { text: 'Unused variable' },
                helpUri: 'https://biomejs.dev/linter/rules/no-unused-variables/',
              },
            ],
          },
        },
        results: [
          {
            ruleId: 'lint/correctness/noUnusedVariables',
            message: { text: 'This variable is unused.' },
          },
        ],
      },
    ],
  });

  const [rule] = sarif.runs[0].tool.driver.rules;
  assert.equal(rule.shortDescription.text, 'Unused variable');
  assert.equal(rule.helpUri, 'https://biomejs.dev/linter/rules/no-unused-variables/');
  assert.equal(sarif.runs[0].results[0].message.text, 'This variable is unused.');
});
