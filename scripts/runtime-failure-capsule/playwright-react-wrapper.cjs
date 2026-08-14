'use strict';

const base = require('codevetter-playwright-react-base-cjs');
const outputDirectory = process.env.CODEVETTER_BROWSER_REACT_DIRECTORY;

const instrumentedTest = base.test.extend({
  codevetterReactProbe: [
    async ({ context }, use) => {
      const { runPlaywrightReactProbe } = await import('./playwright-react-probe.mjs');
      await runPlaywrightReactProbe({ context, use, outputDirectory });
    },
    { auto: true },
  ],
});

module.exports = { ...base, test: instrumentedTest };
