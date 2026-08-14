import * as base from 'codevetter-playwright-react-base';
import { runPlaywrightReactProbe } from './playwright-react-probe.mjs';

export * from 'codevetter-playwright-react-base';

const outputDirectory = process.env.CODEVETTER_BROWSER_REACT_DIRECTORY;

export const test = base.test.extend({
  codevetterReactProbe: [
    async ({ context }, use) => {
      await runPlaywrightReactProbe({ context, use, outputDirectory });
    },
    { auto: true },
  ],
});
