import commandRunnerConfig from './stryker-accounting.config.mjs';

export default {
  ...commandRunnerConfig,
  plugins: ['@stryker-mutator/tap-runner'],
  testRunner: 'tap',
  tap: {
    testFiles: ['scripts/qualify-codex-accounting-oracle.test.mjs'],
    forceBail: true,
  },
  coverageAnalysis: 'perTest',
  jsonReporter: {
    fileName: 'artifacts/tooling/stryker/accounting-tap-mutation-report.json',
  },
};
