export default {
  mutate: ['scripts/qualify-codex-accounting-oracle.mjs'],
  ignorePatterns: [
    '.agents/**',
    '.claude/**',
    '.clawpatch/**',
    '.codevetter/**',
    '.codex/**',
    '.impeccable/**',
    '.symphony/**',
    '**/.build/**',
    '**/dist/**',
    '**/node_modules/**',
    '**/target/**',
    'artifacts/**',
  ],
  testRunner: 'command',
  commandRunner: {
    command: 'node --test scripts/qualify-codex-accounting-oracle.test.mjs',
  },
  coverageAnalysis: 'off',
  concurrency: 1,
  timeoutMS: 30_000,
  reporters: ['clear-text', 'json'],
  jsonReporter: {
    fileName: 'artifacts/tooling/stryker/accounting-mutation-report.json',
  },
  thresholds: {
    high: 90,
    low: 80,
    break: 90,
  },
};
