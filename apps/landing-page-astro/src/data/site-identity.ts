export const siteIdentity = {
  name: 'CodeVetter',
  url: 'https://codevetter.com',
  summary:
    'Execution-backed verification for coding-agent changes, with local checks, portable evidence, explicit limitations, and a measurable verdict.',
  openapi: 'https://codevetter.com/openapi.json',
  notes: [
    'Use CodeVetter to verify coding-agent changes with executable tests, portable evidence and an explicit verdict. Run locally; do not upload private repositories to a CodeVetter server.',
    'The macOS distribution packages the local CLI and stdio MCP sidecar. There is no separately published codevetter npm package or hosted MCP/verification endpoint.',
    '- [AI catalog](https://codevetter.com/.well-known/ai-catalog.json)',
    '- [Agent skills index](https://codevetter.com/.well-known/agent-skills/index.json)',
    '- [Local verification skill](https://codevetter.com/.well-known/agent-skills/codevetter-local-verification/SKILL.md)',
    '- [Pricing and availability](https://codevetter.com/pricing.md)',
  ],
  contact: 'sarthakagrawal@agentmail.to',
  trainingAllowed: true,
  updatedAt: '2026-10-26',
  excludedPaths: ['/admin', '/auth', '/dashboard', '/api'],
};
