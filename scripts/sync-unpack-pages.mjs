#!/usr/bin/env node
// Compacts benchmarks/repo-unpacks/*.json into the landing site's data file
// (src/data/unpack-reports.json) and registers every /unpack/<slug> route in
// public/api-ai.json — the deploy gate requires every public route listed.

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const CORPUS = join(ROOT, 'benchmarks/repo-unpacks');
const OUT = join(ROOT, 'apps/landing-page-astro/src/data/unpack-reports.json');
const API_AI = join(ROOT, 'apps/landing-page-astro/public/api-ai.json');

const KB = 1024;
const fmtBytes = (n) =>
  n >= KB * KB ? `${(n / KB / KB).toFixed(1)} MB` : `${Math.round(n / KB)} KB`;

const DOC_LANGUAGES = new Set(['Markdown', 'HTML', 'CSS', 'JSON', 'YAML', 'Text']);
// README previews are markdown: strip HTML tags, links/images (keep link text),
// and heading/emphasis markers, then take the first readable sentence.
const stripHtml = (s) => {
  if (!s) return null;
  const text = s
    .replace(/<[^>]*>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*#{1,6}\s*/gm, ' ')
    .replace(/[*_`>~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const match = text.match(/^(.{40,260}?[.!])(?:\s|$)/) ?? text.match(/^(.{0,260})/);
  return match ? match[1].trim() : null;
};

// Common source roots, roughly in "most likely to hold the product" order.
const SOURCE_ROOTS = ['src', 'lib', 'crates', 'packages', 'pkg', 'app', 'source', 'core'];
const ENTRY_PATTERNS = [
  /^index\.(js|ts|mjs|cjs|jsx|tsx)$/,
  /^src\/(index|main|mod|lib)\.(js|ts|mjs|cjs|jsx|tsx|rs|py|go)$/,
  /^lib\/(index|main)\.(js|ts|mjs|cjs)$/,
  /^main\.(rs|go|py|c|cc|cpp)$/,
  /^cmd\//,
  /^(app|application)\.(py|js|ts)$/,
  /^setup\.(py|cfg)$/,
  /^pyproject\.toml$/,
  /^Cargo\.toml$/,
  /^go\.mod$/,
];

// Primary source roots from the reliable `top_level_dirs` (the tree preview is
// breadth-capped on big repos like curl and fastapi).
const sourceRoots = (inventory, repoName) => {
  const dirs = inventory.top_level_dirs ?? [];
  const roots = dirs.filter((d) => SOURCE_ROOTS.includes(d.path) || d.path === repoName);
  if (roots.length) return roots.slice(0, 3);
  return dirs
    .filter((d) => !/^(\.|test|tests|docs?|examples?|benchmarks?|scripts?|tools?)/.test(d.path))
    .slice(0, 3);
};

// Module-level layout from the (capped) dir tree — only shown when the chosen
// source root actually appears in the preview, so we never claim coverage the
// scan didn't capture.
const sourceLayout = (tree, roots) => {
  const dirs = (tree?.children ?? []).filter((c) => c.is_dir);
  for (const root of roots) {
    const hit = dirs.find((d) => d.path === root.path);
    if (hit?.children?.length) return { path: hit.path, children: hit.children.slice(0, 14) };
  }
  return null;
};

// The scanner's `entrypoints` skew toward CI/config files; derive the probable
// *source* entry from known conventions. Returns null rather than guessing at
// an unrelated file.
const probableEntry = (tree, inventory, roots) => {
  const paths = [];
  const walk = (node) => {
    paths.push(node.path);
    for (const c of node.children ?? []) if (!c.is_dir || paths.length < 4000) walk(c);
  };
  walk(tree);
  for (const pattern of ENTRY_PATTERNS) {
    const hit = paths.find((p) => pattern.test(p));
    if (hit) return hit;
  }
  const root = roots[0]?.path;
  if (root) {
    const children =
      (tree?.children ?? []).find((c) => c.is_dir && c.path === root)?.children ?? [];
    const main = children.find((c) => !c.is_dir && /^(index|main|lib|mod|__init__)\./.test(c.name));
    if (main) return main.path;
    return `${root}/`;
  }
  return inventory.entrypoints.find((e) => e.kind !== 'config')?.path ?? null;
};

const reports = [];
for (const file of readdirSync(CORPUS)
  .filter((f) => f.endsWith('.json'))
  .sort()) {
  const record = JSON.parse(readFileSync(join(CORPUS, file), 'utf8'));
  const inv = record.scan.inventory;
  const manifest = inv.manifests[0];
  reports.push({
    slug: record.slug,
    repo: record.repo,
    name: inv.repo_name,
    codevetterVersion: record.codevetter_version,
    collectedAt: record.collected_at,
    commit: {
      sha: record.scan.inventory.commit_sha ?? record.last_commit.sha,
      date: record.last_commit.date,
      subject: record.last_commit.subject,
    },
    stats: {
      filesScanned: inv.files_scanned,
      filesSkipped: inv.files_skipped,
      size: fmtBytes(inv.bytes_scanned),
      maxFilesHit: inv.max_files_hit,
      strategy: inv.coverage?.strategy ?? null,
    },
    // File-share across non-doc languages — byte share over-weights Markdown.
    languages: (() => {
      const langs = inv.coverage?.languages ?? inv.languages;
      const code = langs.filter((l) => !DOC_LANGUAGES.has(l.language));
      const total = code.reduce((s, l) => s + l.files, 0) || 1;
      return langs.slice(0, 8).map((l) => ({
        ...l,
        codeShare: DOC_LANGUAGES.has(l.language) ? null : Math.round((l.files / total) * 100),
      }));
    })(),
    sourceRoots: sourceRoots(inv, inv.repo_name),
    sourceLayout: sourceLayout(inv.dir_tree_preview, sourceRoots(inv, inv.repo_name)),
    probableEntry: probableEntry(inv.dir_tree_preview, inv, sourceRoots(inv, inv.repo_name)),
    manifest: manifest
      ? {
          path: manifest.path,
          name: manifest.name,
          version: manifest.version,
          dependencyCount: manifest.dependencies?.length ?? 0,
          dependencies: (manifest.dependencies ?? []).slice(0, 12),
        }
      : null,
    entrypoints: inv.entrypoints.slice(0, 10),
    topDirs: inv.top_level_dirs.slice(0, 8),
    docs: inv.docs.map((d) => d.path).slice(0, 10),
    stackTags: inv.stack_tags,
    health: inv.repo_health
      ? {
          averageScore: inv.repo_health.average_score,
          hotspotCount: inv.repo_health.hotspot_count,
          filesAnalyzed: inv.repo_health.files_analyzed,
          summary: inv.repo_health.summary,
          topFiles: (inv.repo_health.top_files ?? []).slice(0, 3).map((f) => ({
            path: f.path,
            score: f.score,
            lines: f.lines,
            findings: (f.findings ?? []).slice(0, 2).map((x) => x.label),
          })),
        }
      : null,
    history: (inv.history_brief?.recent_commits ?? []).slice(0, 5),
    qaReadiness: inv.qa_readiness
      ? { status: inv.qa_readiness.status, summary: inv.qa_readiness.summary }
      : null,
    readmePreview:
      stripHtml(inv.docs?.find((d) => /readme/i.test(d.path))?.preview)?.slice(0, 280) ?? null,
    // Analysis layer (claude synthesis) — present only after
    // scripts/analyze-unpack-repo.mjs runs for the slug.
    analysis: record.analysis ?? null,
    sections: record.report
      ? Object.fromEntries(
          [
            'overview',
            'system_map',
            'feature_catalog',
            'data_flow',
            'behavior_traces',
            'testing_signals',
            'risk_map',
            'extension_points',
            'agent_handoff',
          ]
            .filter((k) => record.report[k])
            .map((k) => [
              k,
              typeof record.report[k] === 'string'
                ? { summary: record.report[k], claims: [] }
                : {
                    summary: record.report[k].summary,
                    claims: (record.report[k].claims ?? []).map((c) => ({
                      ...c,
                      // Agents occasionally append "(symbol)" after a path — strip it
                      // so the source links resolve.
                      sources: (c.sources ?? []).map((s) => s.replace(/\s*\([^)]*\)\s*$/, '')),
                    })),
                  },
            ])
        )
      : null,
  });
}

writeFileSync(OUT, `${JSON.stringify(reports, null, 2)}\n`, 'utf8');

const catalog = JSON.parse(readFileSync(API_AI, 'utf8'));
const known = new Set(catalog.surfaces.map((s) => s.id));
if (!known.has('unpack')) {
  catalog.surfaces.push({
    id: 'unpack',
    url: 'https://codevetter.com/unpack',
    md: 'https://codevetter.com/unpack.md',
    kind: 'static',
    description:
      'Repository evidence index — deterministic scans of well-known open-source projects',
  });
}
const SECTION_KEYS = [
  'system_map',
  'feature_catalog',
  'data_flow',
  'behavior_traces',
  'testing_signals',
  'risk_map',
  'extension_points',
  'agent_handoff',
];
const sectionTitle = (k) => k.replace(/_/g, ' ');

for (const report of reports) {
  const id = `unpack-${report.slug}`;
  if (!known.has(id)) {
    catalog.surfaces.push({
      id,
      url: `https://codevetter.com/unpack/${report.slug}`,
      md: `https://codevetter.com/unpack/${report.slug}.md`,
      kind: 'static',
      description: `Repo Unpack evidence scan of ${report.repo} at ${report.commit.sha.slice(0, 7)}`,
    });
  }
  if (!report.sections) continue;
  for (const key of SECTION_KEYS) {
    if (!report.sections[key]) continue;
    const sid = `unpack-${report.slug}-${key.replace(/_/g, '-')}`;
    if (known.has(sid)) continue;
    catalog.surfaces.push({
      id: sid,
      url: `https://codevetter.com/unpack/${report.slug}/${key.replace(/_/g, '-')}`,
      md: `https://codevetter.com/unpack/${report.slug}/${key.replace(/_/g, '-')}.md`,
      kind: 'static',
      description: `${sectionTitle(key)} — claim-cited deep dive into ${report.repo} at ${report.commit.sha.slice(0, 7)}`,
    });
  }
}
const pairs = JSON.parse(
  readFileSync(join(ROOT, 'apps/landing-page-astro/src/data/unpack-pairs.json'), 'utf8')
);
for (const pair of pairs) {
  const a = reports.find((r) => r.slug === pair.a);
  const b = reports.find((r) => r.slug === pair.b);
  if (!a || !b) continue;
  const pid = `unpack-${a.slug}-vs-${b.slug}`;
  if (known.has(pid)) continue;
  catalog.surfaces.push({
    id: pid,
    url: `https://codevetter.com/unpack/compare/${a.slug}-vs-${b.slug}`,
    md: `https://codevetter.com/unpack/compare/${a.slug}-vs-${b.slug}.md`,
    kind: 'static',
    description: `Structural codebase comparison of ${a.repo} vs ${b.repo} at pinned commits`,
  });
}

writeFileSync(API_AI, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
console.log(
  `unpack-reports.json: ${reports.length} repos; api-ai surfaces: ${catalog.surfaces.length}`
);
