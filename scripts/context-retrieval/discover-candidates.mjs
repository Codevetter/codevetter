#!/usr/bin/env node

// Reproducible candidate discovery.
//
// The registry started as a list assembled from memory, which is not a defensible
// basis for a published benchmark: a reader cannot tell whether a tool is absent
// because it failed a criterion or because nobody thought of it. This runs the
// search instead, records the exact queries, and diffs the result against the
// registry so the omissions are visible.
//
// Recall over precision on purpose. These queries pull in plenty of things that are
// not context providers; triage is a separate, human-auditable step, and a false
// positive costs a line of triage while a false negative silently shrinks the field.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Keyword queries are AND-matched over name and description by the GitHub API, so
// long phrases return nothing. Short pairs are what actually recall the category.
export const KEYWORD_QUERIES = [
  'code context',
  'codebase context',
  'code search',
  'code retrieval',
  'semantic code',
  'codebase index',
  'repo map',
  'code rag',
  'code graph',
  'code intelligence',
  'symbol search',
  'codebase memory',
  'context compression',
  'repository digest',
  'code navigation',
  'ast search',
  'codebase understanding',
  'code embedding',
  'grep alternative',
  'token efficient',
];

export const TOPIC_QUERIES = [
  'code-search',
  'code-intelligence',
  'codebase',
  'code-analysis',
  'rag',
  'mcp',
  'static-analysis',
  'developer-tools',
  // The ecosystem tags `mcp-server`, not `mcp`, and this category is mostly MCP
  // servers. The rest close gaps that let real members through untagged — one
  // 67.7k-star member carries no topics at all, so topic queries alone are blind
  // to it regardless of how many are added.
  'mcp-server',
  'code-graph',
  'semantic-search',
  'context-engineering',
  'agentic-coding',
  'tree-sitter',
  'grep',
  'code-navigation',
];

// The category's own vocabulary. A repository has to make a claim about code or a
// codebase to be a candidate at all; this is what separates the hits from the
// general-purpose agents and model repos the queries also return.
const SIGNAL = /\b(code|codebase|repo|repositor|symbol|ast|grep|source)\w*\b/i;
const PURPOSE =
  /\b(context|search|retriev|index|graph|rag|embed|semantic|navigat|understand|map|digest|compress|memory|token)\w*\b/i;

export function parseSweep(text) {
  const found = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim().startsWith('[')) continue;
    let rows;
    try {
      rows = JSON.parse(line);
    } catch {
      continue;
    }
    for (const row of rows) {
      if (!row?.fullName) continue;
      found.set(row.fullName, {
        full_name: row.fullName,
        stars: row.stargazersCount ?? 0,
        pushed_at: row.pushedAt ?? null,
        description: (row.description ?? '').slice(0, 240),
      });
    }
  }
  return [...found.values()];
}

export function triage(rows, { minStars = 1000, freshSince } = {}) {
  const kept = [];
  const dropped = [];
  for (const row of rows) {
    const text = `${row.full_name} ${row.description}`;
    const reason =
      row.stars < minStars
        ? 'below-star-floor'
        : freshSince && row.pushed_at && row.pushed_at < freshSince
          ? 'stale-over-six-months'
          : !SIGNAL.test(text)
            ? 'no-code-signal'
            : !PURPOSE.test(text)
              ? 'no-retrieval-purpose'
              : null;
    if (reason) dropped.push({ ...row, reason });
    else kept.push(row);
  }
  const rank = (a, b) => b.stars - a.stars;
  return { kept: kept.sort(rank), dropped: dropped.sort(rank) };
}

// Registry ids are short slugs; repository names are owner/name. Match on the tail
// with separators normalized, so `Codevetter/graphify` lines up with `graphify`.
export function diffAgainstRegistry(kept, registry) {
  // Match on FULL owner/name, never on the tail. Dropping the owner reported RepoWise
  // as covered because `repowise-npm` was present, while the 6.2k-star AGPL
  // `repowise-dev/repowise` had never been evaluated — a different tool with the same
  // name. The same collision recurs for codesearch, octocode, codegraph,
  // claude-context and semble, so this is the common case, not an edge case.
  //
  // Both schema keys are read because the registry uses `repo` on older entries and
  // `repository` on newer ones. The previous version read only `repository`, which no
  // older entry had, so that half of the dedupe was dead code and the diff fell back
  // to matching ids alone.
  const knownSlugs = new Set();
  const knownIds = new Set();
  for (const candidate of registry.candidates ?? []) {
    knownIds.add(normalize(candidate.id));
    const slug = candidate.repo ?? candidate.repository;
    if (slug && slug.includes('/')) knownSlugs.add(normalize(slug));
  }
  const missing = [];
  for (const row of kept) {
    const slug = normalize(row.full_name);
    if (knownSlugs.has(slug)) continue;
    // A bare id match with no recorded slug is weak evidence: it is how the
    // same-name-different-owner miss happened. Surface it as needs-verification
    // rather than silently treating it as covered.
    const tail = normalize(row.full_name.split('/').pop());
    missing.push(
      knownIds.has(tail) && knownSlugs.size > 0
        ? {
            ...row,
            name_collision: `id "${tail}" exists in the registry but no slug matches ${row.full_name} — verify these are the same project`,
          }
        : row
    );
  }
  return { known_slugs: knownSlugs.size, known_ids: knownIds.size, missing };
}

function normalize(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

// Held at 1,000 by owner decision. Recorded tension: this benchmark's own evidence is
// that stars are anti-correlated with retrieval quality, and fully-local, actively
// maintained members sit at 84-533 stars — so the floor is a deliberate scope limit,
// not a quality signal. Sub-floor finds stay in the registry marked
// `excluded-below-star-floor` so the exclusion is auditable rather than invisible.
export function runSweep({ gh = 'gh', minStars = 1000 } = {}) {
  const chunks = [];
  for (const query of KEYWORD_QUERIES) {
    // 200 not 50: best-match ordering meant a query like `code graph` filled its 50
    // slots with repositories whose NAMES contain the tokens and never reached the
    // 67.7k-star project that is the largest member of the category.
    chunks.push(search(gh, ['search', 'repos', query, `--stars=>=${minStars}`, '--limit', '200']));
  }
  for (const topic of TOPIC_QUERIES) {
    chunks.push(
      search(gh, ['search', 'repos', '--topic', topic, `--stars=>=${minStars}`, '--limit', '200'])
    );
  }
  return chunks.join('\n');
}

function search(gh, args) {
  try {
    return execFileSync(gh, [...args, '--json', 'fullName,stargazersCount,pushedAt,description'], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const detail = String(error?.stderr || error?.message || error)
      .split('\n')[0]
      .trim();
    throw new Error(`GitHub discovery failed for ${args.join(' ')}: ${detail || 'unknown error'}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const get = (flag, fallback) => {
    const at = args.indexOf(flag);
    return at === -1 ? fallback : args[at + 1];
  };
  const registryPath = get('--registry');
  if (!registryPath) throw new Error('--registry is required');
  let registry;
  try {
    registry = JSON.parse(readFileSync(registryPath, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read candidate registry ${registryPath}: ${error.message}`);
  }
  const text = get('--from')
    ? readFileSync(get('--from'), 'utf8')
    : runSweep({ minStars: Number(get('--min-stars', '1000')) });
  const { kept, dropped } = triage(parseSweep(text), {
    minStars: Number(get('--min-stars', '1000')),
    freshSince: get('--fresh-since'),
  });
  const { missing } = diffAgainstRegistry(kept, registry);
  process.stdout.write(
    `${JSON.stringify(
      {
        queries: { keyword: KEYWORD_QUERIES, topic: TOPIC_QUERIES },
        surfaced: kept.length,
        dropped: dropped.length,
        drop_reasons: tally(dropped),
        missing_from_registry: missing,
      },
      null,
      2
    )}\n`
  );
}

function tally(rows) {
  const counts = {};
  for (const row of rows) counts[row.reason] = (counts[row.reason] ?? 0) + 1;
  return counts;
}
