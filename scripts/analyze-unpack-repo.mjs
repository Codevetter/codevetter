#!/usr/bin/env node
// Runs the Repo Unpack synthesis layer on a corpus record headlessly:
// builds the same evidence-cited prompt the app uses (see
// build_synthesis_prompt in crates/codevetter-core/src/commands/unpack.rs),
// drives `claude -p` inside a local clone, and stores the parsed report on
// the corpus record. Requires a clone dir containing the repo at the scanned
// commit.
//
//   node scripts/analyze-unpack-repo.mjs <slug> --clone <path-to-clone>

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const CORPUS = join(ROOT, 'benchmarks/repo-unpacks');

const [slug, ...rest] = process.argv.slice(2);
const cloneFlag = rest.indexOf('--clone');
const cloneDir = cloneFlag >= 0 ? rest[cloneFlag + 1] : null;
if (!slug || !cloneDir) {
  console.error('usage: node scripts/analyze-unpack-repo.mjs <slug> --clone <path>');
  process.exit(1);
}

const corpusPath = join(CORPUS, `${slug}.json`);
const record = JSON.parse(readFileSync(corpusPath, 'utf8'));
const inv = record.scan.inventory;

const headSha = execFileSync('git', ['-C', cloneDir, 'rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim();
if (headSha !== inv.commit_sha) {
  console.error(
    `clone is at ${headSha.slice(0, 7)} but the scan is of ${inv.commit_sha.slice(0, 7)} — refusing to mix commits`
  );
  process.exit(1);
}

const lines = (arr, fmt) => arr.map(fmt).join('\n');
const inventoryContext = [
  `Repo: ${inv.repo_name}`,
  `Commit: ${inv.commit_sha}`,
  `Branch: ${inv.branch ?? 'unknown'}`,
  `Remote: ${inv.remote_url ?? 'unknown'}`,
  `Files scanned: ${inv.files_scanned} (skipped ${inv.files_skipped})`,
  inv.max_files_hit ? '(file walk was capped — large repo)' : null,
  `Stack tags: ${(inv.stack_tags ?? []).join(', ')}`,
  '',
  'Languages (top 10):',
  lines(
    (inv.languages ?? []).slice(0, 10),
    (l) => `  - ${l.language} — ${l.files} files, ${l.bytes} bytes`
  ),
  '',
  'Top-level dirs:',
  lines((inv.top_level_dirs ?? []).slice(0, 20), (d) => `  - ${d.path}/ — ${d.file_count} files`),
  '',
  'Manifests:',
  lines(
    (inv.manifests ?? []).slice(0, 10),
    (m) =>
      `  - ${m.path} (${m.kind})${m.name ? ` name=${m.name}` : ''}${m.version ? ` v${m.version}` : ''}`
  ),
  '',
  'Entrypoints detected:',
  lines((inv.entrypoints ?? []).slice(0, 15), (e) => `  - ${e.path} (${e.reason})`),
  '',
  'Docs:',
  lines((inv.docs ?? []).slice(0, 15), (d) => `  - ${d.path}`),
  '',
  'Config files:',
  (inv.config_files ?? []).slice(0, 15).join(', '),
]
  .filter((x) => x !== null)
  .join('\n');

const prompt = `You are CodeVetter Repo Unpacked. You will produce a deep, evidence-backed system brief
for the repo described below. The inventory I've assembled is only the skeleton — your job is to
INVESTIGATE the repo using your file-read and search tools, then synthesise a rich brief grounded
in what you actually read. Return ONLY valid JSON (no markdown fences, no commentary).

Investigation requirements (do these before writing claims):
- Open and read at least 12 source files. Prioritise: every listed entrypoint, the top 3 manifests, the largest source files in the top dirs, all notable configs, and any docs that describe architecture.
- Walk at least 3 user-visible flows end-to-end (e.g. "startup", "primary action", "persistence path") by reading the relevant files in sequence.
- Inspect tests if present. Note framework, what is covered, what isn't.
- Look for security-sensitive code paths (auth, secrets, IPC, shell-out, network, file IO outside repo root).
- Look for extension points (registries, plugin systems, command tables, routers, factory functions).

Required JSON shape:
{
  "overview": "2-4 sentence elevator pitch grounded in what you actually read — what the system does, who it's for, what's distinctive.",
  "system_map": { "summary": "...", "claims": [{"claim":"...","sources":["src/main.rs"],"kind":"evidence"}] },
  "feature_catalog":   { "summary": "...", "claims": [...] },
  "data_flow":         { "summary": "...", "claims": [...] },
  "behavior_traces":   { "summary": "...", "claims": [...] },
  "testing_signals":   { "summary": "...", "claims": [...] },
  "risk_map":          { "summary": "...", "claims": [...] },
  "extension_points":  { "summary": "...", "claims": [...] },
  "agent_handoff":     { "summary": "...", "claims": [...] },
  "agent_prompt": "Reusable prompt block (300-700 words) future agents can paste in to onboard."
}

Rules:
- Every claim MUST list at least one \`sources\` file path that EXISTS in the repo. Multi-file claims are encouraged — cite 2-4 sources where appropriate.
- You may append \`#Lstart-end\` to a source path to point at a specific line range you read.
- Use kind "evidence" when sources directly support the claim. Use kind "inference" only when reading between the lines; mark such claims clearly and use them sparingly (<20% of claims).
- Do not invent files. If you cannot cite a file, omit the claim.
- Target 8-15 claims per section. Each claim should be concrete and load-bearing — name functions, commands, files, env vars, types. Avoid vague restatements.
- Each section summary should be 3-6 sentences. Do not pad.

Section briefs:
- system_map: entrypoints, modules, runtime boundaries, storage layer, external integrations, build/test commands, deployment shape.
- feature_catalog: every user-facing feature — routes, screens, CLI subcommands, jobs, APIs, provider integrations.
- data_flow: how data moves end-to-end. Input boundaries → transforms → state owners → output boundaries.
- behavior_traces: ordered walk-throughs of important flows (startup, primary action, persistence). Name the functions called in order.
- testing_signals: test frameworks, which dirs hold tests, what's covered vs uncovered, CI integration.
- risk_map: security-sensitive paths, untested critical flows, fragile coupling, dead/legacy code, blast-radius hotspots.
- extension_points: where new code is meant to plug in — registries, command tables, plugin interfaces, route lists, factory functions.
- agent_handoff: conventions, safe edit boundaries, files an agent must read first, tests to run, known traps.
- agent_prompt: a copy-pasteable handoff prompt summarising the project for future agents.

${inventoryContext}`;

if (!existsSync(join(cloneDir, '.git'))) {
  console.error(`${cloneDir} is not a git clone`);
  process.exit(1);
}

console.log(
  `analyzing ${record.repo} at ${headSha.slice(0, 7)} via claude -p (this takes minutes)…`
);
const started = Date.now();
const raw = execFileSync(
  'claude',
  ['-p', '--output-format', 'json', '--allowedTools', 'Read Glob Grep LS WebSearch WebFetch'],
  {
    encoding: 'utf8',
    cwd: cloneDir,
    input: prompt,
    maxBuffer: 64 * 1024 * 1024,
    timeout: 20 * 60 * 1000,
  }
);
const envelope = JSON.parse(raw);
const text = envelope.result ?? '';
const jsonStart = text.indexOf('{');
const jsonEnd = text.lastIndexOf('}');
if (jsonStart < 0 || jsonEnd <= jsonStart) {
  console.error('no JSON object in agent output; first 400 chars:', text.slice(0, 400));
  process.exit(1);
}
const report = JSON.parse(text.slice(jsonStart, jsonEnd + 1));

record.report = report;
record.analysis = {
  agent: 'claude',
  model: 'cli:claude',
  runtime_ms: Date.now() - started,
  cost_usd: envelope.total_cost_usd ?? null,
  collected_at: new Date().toISOString(),
};
writeFileSync(corpusPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
console.log(
  `${record.repo}: report written — $${(envelope.total_cost_usd ?? 0).toFixed(2)}, ${Math.round((Date.now() - started) / 1000)}s`
);
