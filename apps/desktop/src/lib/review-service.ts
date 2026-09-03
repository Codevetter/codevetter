/** Review-standards persistence. Provider credentials are never stored here. */

export interface ReviewConfig {
  customRules?: string[];
  activeStandardsPack?: string;
  standardsPacks?: StandardsPack[];
}

const STORAGE_KEY = 'codevetter_review_config';

export interface StandardsPack {
  id: string;
  name: string;
  focus: string;
  checks: string[];
}

export const DEFAULT_STANDARDS_PACKS: StandardsPack[] = [
  {
    id: 'product-safety',
    name: 'Product Safety',
    focus: 'User-facing regressions, broken flows, data loss, and confusing states.',
    checks: [
      'Flag behavior changes that can break an existing user workflow.',
      'Check loading, empty, error, and permission states for user-facing screens.',
      'Prioritize concrete reproduction steps over style commentary.',
    ],
  },
  {
    id: 'security-boundary',
    name: 'Security Boundary',
    focus: 'Auth, authorization, secret handling, trust boundaries, and injection risk.',
    checks: [
      'Verify server-side authorization, not just hidden client controls.',
      'Flag secrets, tokens, PII, or prompts that can leak into logs or analytics.',
      'Check untrusted input before database, shell, network, or model calls.',
    ],
  },
  {
    id: 'agent-handoff',
    name: 'Agent Handoff',
    focus: 'Review quality for multi-agent workflows and future task continuity.',
    checks: [
      'Call out missing tests or verification commands the next agent must run.',
      'Prefer findings with file paths, line numbers, and a bounded fix.',
      'Separate real blockers from optional cleanup so agents do not waste context.',
    ],
  },
];

function isStandardsPack(value: unknown): value is StandardsPack {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<StandardsPack>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.focus === 'string' &&
    Array.isArray(candidate.checks) &&
    candidate.checks.every((check) => typeof check === 'string')
  );
}

function sanitizeReviewConfig(value: unknown): ReviewConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<ReviewConfig>;
  const config: ReviewConfig = {};

  if (Array.isArray(candidate.customRules)) {
    config.customRules = candidate.customRules.filter(
      (rule): rule is string => typeof rule === 'string'
    );
  }
  if (typeof candidate.activeStandardsPack === 'string') {
    config.activeStandardsPack = candidate.activeStandardsPack;
  }
  if (Array.isArray(candidate.standardsPacks)) {
    config.standardsPacks = candidate.standardsPacks.filter(isStandardsPack);
  }
  return config;
}

export function loadReviewConfig(): ReviewConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const config = sanitizeReviewConfig(JSON.parse(raw));
    if (!config) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    const sanitized = JSON.stringify(config);
    if (sanitized !== raw) localStorage.setItem(STORAGE_KEY, sanitized);
    return config;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function saveReviewConfig(config: ReviewConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeReviewConfig(config) ?? {}));
}

export function getStandardsPacks(config: ReviewConfig | null): StandardsPack[] {
  const customPacks = config?.standardsPacks ?? [];
  const seen = new Set<string>();
  return [...DEFAULT_STANDARDS_PACKS, ...customPacks].filter((pack) => {
    if (seen.has(pack.id)) {
      return false;
    }
    seen.add(pack.id);
    return true;
  });
}

export function getActiveStandardsPack(config: ReviewConfig | null): StandardsPack {
  const packs = getStandardsPacks(config);
  return packs.find((pack) => pack.id === config?.activeStandardsPack) ?? packs[0];
}

/**
 * Render the exact standards-context string injected into review prompts.
 * Pass a `pack` to preview a specific pack (used by the Rubrics editor);
 * omit it to render the currently-active pack from stored config.
 */
export function buildStandardsContext(pack: StandardsPack, customRules: string[] = []): string {
  const rules = customRules.map((rule) => rule.trim()).filter(Boolean);
  const lines = [
    'CodeVetter review standards pack:',
    `- Pack: ${pack.name}`,
    `- Focus: ${pack.focus}`,
    ...pack.checks.map((check) => `- Check: ${check}`),
    ...rules.map((rule) => `- Custom rule: ${rule}`),
  ];
  return lines.join('\n');
}

export function buildActiveStandardsContext(): string {
  const config = loadReviewConfig();
  const pack = getActiveStandardsPack(config);
  return buildStandardsContext(pack, config?.customRules ?? []);
}

/**
 * Attribution key (pack ID) that a review run will be tagged with. IDs are
 * unique across built-in + custom packs (names are not — duplicate-named packs
 * would irreversibly merge usage stats). Returns null when the user has never
 * explicitly selected a pack: the prompt still uses the default pack's rules,
 * but usage stats must not book fabricated selections to "Product Safety".
 */
export function getActiveStandardsPackId(): string | null {
  const config = loadReviewConfig();
  if (!config?.activeStandardsPack) return null;
  return getActiveStandardsPack(config).id;
}
