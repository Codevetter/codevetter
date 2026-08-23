#!/usr/bin/env node

// Repository size tiers, and the protocol each tier is measured under.
//
// Why this exists: every repository in the first version of this benchmark held
// between 83 and 141 code files. Those results were published as "the field" when
// they were in fact one narrow tier, and the single most consequential finding about
// any provider — that one of them cannot index a 1,461-file repository at all —
// was invisible because nothing that large was ever measured.
//
// Tiers are assigned by MEASURING a repository, never by choosing a repository to
// fill a tier. That ordering matters: picking the repo after knowing the boundary is
// how a benchmark ends up with tiers that flatter a particular tool's sweet spot.

import { execFileSync } from 'node:child_process';

// Extensions counted as code. Deliberately the same set the corpus builder uses, so
// "files in the repo" and "files a provider could be asked about" cannot drift.
// Deliberately NOT the shared vocabulary in ./paths.mjs, which asks "could a tool have
// meant this path". This asks "how much code is in this repository", to place it in a
// size tier — a lockfile and a changelog are not code by that measure even though both
// are legitimate retrieval targets. Keep the two separate.
const CODE_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|php|swift|kt|astro)$/;

// Boundaries sit at observed failure points, not round numbers. A graph provider
// failed on a 1,461-file repository against its own 32 MB / 100k-node import
// ceiling, so the medium ceiling is set below that: a repository of that size must
// land in `large` and be measured under the large-tier protocol, or the benchmark
// cannot observe the scale limit that matters most.
//
// This boundary was originally 1,500, which put the 1,461-file case in `medium` and
// would have hidden exactly that. The tier test now asserts the relationship rather
// than the number, so the constant cannot drift back.
export const TIERS = [
  { id: 'small', max_code_files: 250, protocol: 'per-case-index' },
  { id: 'medium', max_code_files: 1000, protocol: 'per-case-index' },
  { id: 'large', max_code_files: Number.POSITIVE_INFINITY, protocol: 'fixed-index' },
];

export function countCodeFiles(repo) {
  const listed = execFileSync('git', ['-C', repo, 'ls-files'], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  let count = 0;
  for (const line of listed.split('\n')) {
    if (CODE_EXTENSIONS.test(line)) count += 1;
  }
  return count;
}

// Tier must be measured at the revisions the cases are actually scored at, not at
// HEAD. private-A reads 69 code files at HEAD and 537 at its median case revision,
// because a monorepo was extracted out of it partway through its history — so it was
// labelled `small` while most of its cases were scored against a `medium` tree. A
// provider was then judged to have a capacity defect on the strength of the wrong
// number. Nine of ten repositories measured are stable; this exists for the tenth.
export function tierFromRevisions(repo, revisions, { sample = 20 } = {}) {
  const counts = [];
  for (const revision of revisions.slice(0, sample)) {
    try {
      const listed = execFileSync('git', ['-C', repo, 'ls-tree', '-r', '--name-only', revision], {
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
      });
      let count = 0;
      for (const line of listed.split('\n')) if (CODE_EXTENSIONS.test(line)) count += 1;
      counts.push(count);
    } catch {
      // A revision that cannot be listed contributes nothing rather than a zero.
    }
  }
  if (counts.length === 0) return { ok: false, reason: 'no revision could be listed' };
  const sorted = [...counts].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const tiers = [...new Set(counts.map((n) => classify(n).id))];
  return {
    ok: true,
    tier: classify(median).id,
    median_code_files: median,
    min_code_files: sorted[0],
    max_code_files: sorted.at(-1),
    // A corpus spanning tiers cannot be attributed to any one of them. Reported so
    // the row is excluded or split rather than silently averaged.
    spans_tiers: tiers.length > 1 ? tiers : null,
  };
}

export function classify(codeFiles) {
  return TIERS.find((tier) => codeFiles <= tier.max_code_files) ?? TIERS.at(-1);
}

// Two protocols, because per-case reindexing does not survive scale. On a 109-file
// repository a graph build costs 3–43 s, so 76 cases across 19 arms is hours. On a
// 3,000-file repository the same design is days, and nobody would rerun it — which
// makes it useless as a published benchmark regardless of how correct it is.
//
// fixed-index keeps the property that actually matters. Index once at a pinned
// revision R, then draw every case from fixes that landed strictly AFTER R. The
// index therefore never contains the fix, which is the same guarantee per-case
// indexing gives, at one index per repository instead of one per case.
//
// It is also closer to real use: an agent queries an index built earlier, not one
// rebuilt for its question. The cost is that a provider cannot be credited for
// incremental reindexing in this tier, which is recorded rather than hidden.
export function protocolFor(tierId) {
  const tier = TIERS.find((entry) => entry.id === tierId);
  if (!tier) throw new Error(`unknown tier: ${tierId}`);
  return tier.protocol;
}

// A case is only admissible under fixed-index if its fix is not already in the
// index. Enforced rather than assumed: an off-by-one here would silently hand every
// provider the answer and inflate the whole tier.
export function admissibleUnderFixedIndex({ repo, indexRevision, caseRevision }) {
  try {
    // Exit 0 means indexRevision is an ancestor of caseRevision, i.e. the case is
    // strictly newer than the index.
    execFileSync('git', ['-C', repo, 'merge-base', '--is-ancestor', indexRevision, caseRevision], {
      stdio: 'ignore',
    });
    return indexRevision !== caseRevision;
  } catch {
    return false;
  }
}
