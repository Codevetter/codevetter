export const scenarioModule = {
  id: 'codevetter-shell',
  scenarios: [
    {
      schemaVersion: 1,
      id: 'shell-navigation',
      capabilityIds: ['app-shell'],
      route: '/',
      authProfileId: 'local-developer',
      stateName: 'shell-navigation-ready',
      frozenTime: '2026-07-15T10:00:00.000Z',
      flags: {},
      timeouts: { actionMs: 3000, scenarioMs: 10000 },
      actions: [
        { id: 'open-trex', kind: 'click', description: 'Open Testing from the shell' },
        { id: 'verify-trex', kind: 'wait', description: 'Wait for the Testing route' },
        { id: 'return-home', kind: 'click', description: 'Return to Usage' },
      ],
      assertions: [
        { id: 'trex-route', kind: 'route', description: 'T-Rex opens directly' },
        {
          id: 'shell-visible',
          kind: 'visible',
          description: 'The CodeVetter shell remains visible',
        },
        { id: 'runtime-clean', kind: 'runtime_errors', description: 'No runtime error occurs' },
      ],
      async run({ page, observe, step }) {
        await step(
          'open-trex',
          () => page.getByRole('link', { name: 'Testing', exact: true }).click(),
          'actionability_and_dispatch'
        );
        await step('verify-trex', () => observe.expectRoute('/trex'), 'settlement');
        await step('trex-visible', () => observe.expectVisible('Testing'), 'assertion');
        await step(
          'return-home',
          () => page.getByRole('link', { name: 'Usage', exact: true }).click(),
          'actionability_and_dispatch'
        );
        await step('home-route', () => observe.expectRoute('/'), 'settlement');
        await step('shell-visible', () => observe.expectVisible('CodeVetter'), 'assertion');
        await step('runtime-clean', () => observe.expectNoRuntimeErrors(), 'assertion');
      },
    },
    {
      schemaVersion: 1,
      id: 'command-search',
      capabilityIds: ['command-search'],
      route: '/',
      authProfileId: 'local-developer',
      stateName: 'shell-navigation-ready',
      frozenTime: '2026-07-15T10:00:00.000Z',
      flags: {},
      timeouts: { actionMs: 3000, scenarioMs: 10000 },
      actions: [
        { id: 'open-search', kind: 'click', description: 'Open command search from the sidebar' },
        { id: 'wait-search', kind: 'wait', description: 'Wait for command search to settle' },
        { id: 'close-search', kind: 'press', description: 'Close command search with Escape' },
      ],
      assertions: [
        { id: 'search-focused', kind: 'custom', description: 'Search input receives focus' },
        { id: 'search-closed', kind: 'hidden', description: 'Command search closes cleanly' },
        { id: 'runtime-clean', kind: 'runtime_errors', description: 'No runtime error occurs' },
      ],
      async run({ page, observe, step }) {
        const searchButton = page.getByRole('button', { name: 'Search pages and actions' });
        const searchInput = page.getByPlaceholder('Search pages and actions...');
        const dialog = page.getByRole('dialog');
        await step('open-search', () => searchButton.click(), 'actionability_and_dispatch');
        await step('wait-search', () => dialog.waitFor({ state: 'visible' }), 'settlement');
        await step(
          'search-focused',
          async () => {
            const focused = await searchInput.evaluate(
              (element) => document.activeElement === element
            );
            if (!focused) throw new Error('Command search input did not receive focus');
          },
          'assertion'
        );
        await step('close-search', () => page.keyboard.press('Escape'), 'cleanup');
        await step('search-closed', () => dialog.waitFor({ state: 'hidden' }), 'cleanup');
        await step('runtime-clean', () => observe.expectNoRuntimeErrors(), 'assertion');
      },
    },
    {
      schemaVersion: 1,
      id: 'usage-home',
      capabilityIds: ['usage-home'],
      route: '/',
      authProfileId: 'local-developer',
      stateName: 'shell-navigation-ready',
      frozenTime: '2026-07-15T10:00:00.000Z',
      flags: {},
      timeouts: { actionMs: 3000, scenarioMs: 10000 },
      actions: [
        { id: 'wait-usage', kind: 'wait', description: 'Wait for usage telemetry to render' },
      ],
      assertions: [
        { id: 'usage-visible', kind: 'visible', description: 'Usage telemetry is visible' },
        { id: 'provider-visible', kind: 'visible', description: 'Provider telemetry is visible' },
        { id: 'runtime-clean', kind: 'runtime_errors', description: 'No runtime error occurs' },
      ],
      async run({ observe, step }) {
        await step('wait-usage', () => observe.expectVisible('Usage telemetry'), 'settlement');
        await step(
          'provider-visible',
          () => observe.expectVisible('Provider telemetry'),
          'assertion'
        );
        await step('runtime-clean', () => observe.expectNoRuntimeErrors(), 'assertion');
      },
    },
  ],
};
