/**
 * Single source of truth for the privacy policy.
 *
 * `/privacy` (HTML), `/privacy.md` (agent-facing Markdown), the page JSON-LD,
 * and the privacy quotations reused on the comparison pages are all projected
 * from the structure below. Do not restate any of this text elsewhere — import
 * it. `apps/landing-page-astro/scripts/verify-agent-surfaces.mjs` fails the
 * build if the published HTML and Markdown surfaces stop agreeing.
 *
 * Previously `/privacy` and `/privacy.md` were two hand-maintained copies that
 * had drifted apart (Codevetter/codevetter#254).
 */

/** One bullet in a privacy section. `label` renders as a lead-in `<strong>`. */
interface PrivacyBullet {
  label?: string;
  text: string;
}

/**
 * One `<h2>` section. Body strings support a single inline convention,
 * `` `code` ``, so the same source renders to HTML and to Markdown.
 */
interface PrivacySection {
  heading: string;
  paragraphs?: string[];
  bullets?: PrivacyBullet[];
}

/**
 * Model providers named on the privacy page.
 *
 * Kept in step with the provider boundary shown on the home page
 * (`src/components/Providers.astro`) and with the provider identifiers the
 * Rust core accepts (`crates/codevetter-core`).
 */
const PROVIDERS = ['Anthropic', 'OpenAI', 'OpenRouter', 'your own gateway'] as const;

/** Rendered provider list, e.g. `Anthropic, OpenAI, OpenRouter, your own gateway`. */
const privacyProviderList = PROVIDERS.join(', ');

/**
 * The provider-boundary sentence. The comparison pages
 * (`src/data/verification-content.ts`) quote it verbatim; if you reword it,
 * update those quotations too — `verify-agent-surfaces.mjs` fails the build
 * when a published page misquotes the provider list.
 */
const privacyProviderSentence = `When you run a review, CodeVetter sends your code + the review prompt to whichever provider (${privacyProviderList}) you've picked. Their privacy policy applies.`;

/** ISO date shown on both surfaces. Bump it whenever the text below changes. */
const privacyLastUpdated = '2026-09-28';

/** The `Last updated:` line rendered at the top of both surfaces. */
const privacyLastUpdatedLine = `Last updated: ${privacyLastUpdated}.`;

export const privacyPolicy = {
  title: 'CodeVetter privacy',
  seoTitle: 'Privacy — CodeVetter',
  description:
    'What CodeVetter stores, what it never sends to a server, and how API keys are handled.',
  path: '/privacy',
  lastUpdated: privacyLastUpdated,
  sections: [
    {
      heading: 'Local-first by design',
      paragraphs: [
        "CodeVetter is a native macOS app. Reviews run on your machine. The repo you point it at, the diff being reviewed, your notes, and the review history all live in a local SQLite database in the app data directory. None of that goes to a CodeVetter-owned server — there isn't one.",
      ],
    },
    {
      heading: 'What hits third parties',
      bullets: [
        {
          label: 'The LLM provider you configure.',
          text: privacyProviderSentence,
        },
        {
          label: 'Auto-updater.',
          text: 'The app checks GitHub Releases for new versions. That request includes your platform string and the current version. Disable in settings if you prefer.',
        },
      ],
    },
    {
      heading: 'API keys',
      paragraphs: [
        'Provider API keys are yours and stay on your machine. CodeVetter reads them from your local application settings or from the environment it is launched with; they are never transmitted to CodeVetter, and they leave your machine only inside the Authorization header of a request you initiate to the provider you chose.',
      ],
    },
    {
      heading: 'Crash and usage telemetry',
      paragraphs: [
        'None by default. The first launch does not phone home; there is no anonymous usage analytics endpoint baked into the app.',
      ],
    },
    {
      heading: 'Public website analytics',
      paragraphs: [
        'The public codevetter.com marketing and benchmark pages use PostHog and Microsoft Clarity to understand page visits and interactions. Those pages have no repository upload or CodeVetter account surface. This does not add telemetry to the desktop application.',
      ],
    },
    {
      heading: 'Optional product updates',
      paragraphs: [
        'If you enter your email in the optional product-updates form and give consent, the SaaS Maker subscription service stores your address and consent record to manage that subscription. The form sends your address to SaaS Maker; CodeVetter does not receive it through App Health or link it to desktop-app activity. The form is optional, and the desktop application does not include it.',
      ],
    },
    {
      heading: 'Deletion',
      paragraphs: [
        'Uninstall the app and delete the data directory (`~/Library/Application Support/CodeVetter` on macOS) to remove all local state.',
      ],
    },
  ] satisfies PrivacySection[],
};

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Escape a body string for HTML and render its `` `code` `` spans. */
export function privacyInlineHtml(value: string): string {
  return escapeHtml(value).replaceAll(/`([^`]+)`/g, '<code class="text-amber-400">$1</code>');
}

/**
 * The Markdown body of `/privacy.md`, projected from `privacyPolicy`.
 *
 * Backticked spans pass through untouched because the source convention is
 * already Markdown.
 */
export function privacyMarkdownBody(): string {
  const blocks: string[] = [privacyLastUpdatedLine];

  for (const section of privacyPolicy.sections) {
    blocks.push(`## ${section.heading}`);
    for (const paragraph of section.paragraphs ?? []) {
      blocks.push(paragraph);
    }
    const bullets = section.bullets ?? [];
    if (bullets.length > 0) {
      blocks.push(
        bullets
          .map((bullet) => `- ${bullet.label ? `**${bullet.label}** ` : ''}${bullet.text}`)
          .join('\n')
      );
    }
  }

  return blocks.join('\n\n');
}
