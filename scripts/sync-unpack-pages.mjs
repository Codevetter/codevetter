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
    languages: (inv.coverage?.languages ?? inv.languages).slice(0, 8),
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
    history: (inv.history_brief?.recent_commits ?? []).slice(0, 3),
    qaReadiness: inv.qa_readiness
      ? { status: inv.qa_readiness.status, summary: inv.qa_readiness.summary }
      : null,
    readmePreview: inv.docs?.find((d) => /readme/i.test(d.path))?.preview?.slice(0, 280) ?? null,
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
for (const report of reports) {
  const id = `unpack-${report.slug}`;
  if (known.has(id)) continue;
  catalog.surfaces.push({
    id,
    url: `https://codevetter.com/unpack/${report.slug}`,
    md: `https://codevetter.com/unpack/${report.slug}.md`,
    kind: 'static',
    description: `Repo Unpack evidence scan of ${report.repo} at ${report.commit.sha.slice(0, 7)}`,
  });
}
writeFileSync(API_AI, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
console.log(
  `unpack-reports.json: ${reports.length} repos; api-ai surfaces: ${catalog.surfaces.length}`
);
