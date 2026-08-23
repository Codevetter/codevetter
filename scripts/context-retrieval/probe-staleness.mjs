#!/usr/bin/env node

// Staleness probe: does the provider notice its index is out of date?
//
// Every other metric here assumes the index matches the tree. In real use it does
// not — you indexed this morning and the code moved since. The failure mode that
// matters is a provider confidently returning code that no longer exists, because
// an agent will then edit a function that was deleted yesterday.
//
// Method, using deletion because "returned a file that is gone" is unfalsifiable
// in a way that "returned slightly stale content" is not:
//
//   1. materialize a worktree at R, where the target file exists
//   2. let the provider build its index there
//   3. check out R+1 in the SAME worktree — the file is now gone
//   4. query WITHOUT re-indexing
//   5. classify what comes back
//
// grep is the reference arm: it holds no index and reads the tree live, so it can
// never serve a phantom. Its phantom rate is 0 by construction, and every indexed
// provider is trading exactly that guarantee for speed. The probe measures the price.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const STALENESS_SCHEMA_VERSION = 'codevetter.context-retrieval-staleness.v1';

const UNIT = '\u001f';

export const OUTCOMES = Object.freeze({
  // Best: the provider knows its index no longer matches and says so.
  REFUSED: 'refused-stale-index',
  // Acceptable: answers but flags staleness.
  WARNED: 'warned-stale-index',
  // Good behaviour, but the operator silently pays a rebuild.
  REFRESHED: 'auto-refreshed',
  // Dangerous: hands the agent a file that no longer exists, with no signal.
  PHANTOM: 'served-phantom',
  // Answered without the deleted path — correct, though possibly by luck.
  CLEAN: 'no-phantom',
  // Answered with nothing: avoids a phantom, demonstrates nothing.
  EMPTY: 'empty-result',
  UNAVAILABLE: 'unavailable',
});

// Terms that a stale index would still associate with the deleted file.
export function deletionQuery(deletedPath) {
  const stem = deletedPath
    .split('/')
    .pop()
    .replace(/\.[a-z]+$/i, '');
  return stem
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .join(' ');
}

export function findDeletionCases({ repo, limit = 40, maxCases = 6 }) {
  const log = execFileSync(
    'git',
    [
      '-C',
      repo,
      'log',
      '--diff-filter=D',
      '--name-only',
      `--format=${UNIT}COMMIT${UNIT}%H`,
      `--max-count=${limit}`,
      '--no-merges',
    ],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
  );
  const cases = [];
  let commit = null;
  for (const raw of log.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('COMMIT')) {
      commit = line.split(UNIT)[2];
      continue;
    }
    if (!commit || !line || !/\.(ts|tsx|mjs|js|py|rs|go)$/.test(line)) continue;
    // Generated or vendored trees are not interesting deletions.
    if (/(^|\/)(coverage|dist|build|node_modules)\//.test(line)) continue;
    let parent;
    try {
      parent = execFileSync('git', ['-C', repo, 'rev-parse', `${commit}^`], {
        encoding: 'utf8',
      }).trim();
    } catch {
      continue;
    }
    cases.push({
      deletion_commit: commit,
      indexed_revision: parent,
      deleted_path: line,
      query: deletionQuery(line),
    });
    if (cases.length >= maxCases) break;
  }
  return cases;
}

// Each provider needs explicit index-then-query control, which the retrieval
// adapters deliberately bundle. Declared here rather than reusing them.
export function providerRunners({
  graphifyBinary,
  codesearchBinary,
  fixtureTool,
  zoektBinary,
  sembleBinary,
  cacheDir,
}) {
  const runners = new Map();

  runners.set('keyword-search', {
    holds_index: false,
    index: () => ({ ok: true }),
    query: ({ worktree, query }) => ({
      output: tryRun('git', [
        '-C',
        worktree,
        'grep',
        '--name-only',
        '--ignore-case',
        '--fixed-strings',
        '-e',
        query.split(' ')[0],
      ]),
    }),
  });

  if (graphifyBinary) {
    runners.set('graphify', {
      holds_index: true,
      index: ({ worktree }) => ({
        ok: tryRun(graphifyBinary, ['update', worktree, '--no-cluster'], worktree) !== null,
      }),
      query: ({ worktree, query }) => ({
        output: tryRun(graphifyBinary, [
          'query',
          query,
          '--graph',
          join(worktree, 'graphify-out', 'graph.json'),
          '--budget',
          '2000',
        ]),
      }),
    });
  }

  if (codesearchBinary) {
    runners.set('codesearch', {
      holds_index: true,
      index: ({ worktree }) => ({
        ok: tryRun(codesearchBinary, ['index', 'add', worktree], worktree, cacheDir) !== null,
      }),
      // No --sync: the point is to observe the stale index, not refresh it.
      query: ({ worktree, query }) => ({
        output: tryRun(
          codesearchBinary,
          ['search', query, '--path', worktree, '--compact', '--quiet'],
          worktree,
          cacheDir
        ),
      }),
    });
  }

  if (zoektBinary) {
    runners.set('zoekt', {
      holds_index: true,
      index: ({ worktree }) => ({
        ok: tryRun(`${zoektBinary}-index`, ['-index', cacheDir, worktree], worktree) !== null,
      }),
      query: ({ query }) => ({
        output: tryRun(zoektBinary, ['-index_dir', cacheDir, '-l', query.split(' ')[0]]),
      }),
    });
  }
  if (sembleBinary) {
    runners.set('semble', {
      holds_index: true,
      // semble indexes lazily on first search, so the index step is that first query.
      index: ({ worktree }) => ({
        ok:
          tryRun(sembleBinary, ['search', 'initial index warm', '--top-k', '5'], worktree) !== null,
      }),
      query: ({ worktree, query }) => ({
        output: tryRun(sembleBinary, ['search', query, '--top-k', '20'], worktree),
      }),
    });
  }
  if (fixtureTool) {
    runners.set('codevetter-structural-context', {
      holds_index: true,
      index: ({ worktree, revision, snapshot }) => ({
        ok: tryRun(fixtureTool, ['build', worktree, revision, snapshot]) !== null,
      }),
      query: ({ query, snapshot }) => ({
        output: tryRun(fixtureTool, ['query', snapshot, query, '60']),
      }),
    });
  }

  return runners;
}

export function classify({ output, deletedPath, holdsIndex, exitCode = 0 }) {
  if (output === null) return OUTCOMES.UNAVAILABLE;
  const text = String(output);
  const basename = deletedPath.split('/').pop();

  // Primary signal, mechanical: did the provider hand back a path that no longer
  // exists? This is observable and cannot be argued with. Deliberately checked
  // BEFORE any prose inspection — the first version of this probe matched the word
  // "stale" inside its own worktree path and reported every provider as clean.
  const returnedDeleted = text.includes(deletedPath) || text.includes(basename);

  // Staleness detection only counts on a strong signal: a non-zero exit, or a full
  // phrase, never a bare keyword that a file path could contain.
  const declaresStale =
    exitCode !== 0 ||
    /\b(index (is )?(stale|out of date|outdated)|stale index|needs? re-?index)\b/i.test(text);
  if (declaresStale) {
    return /\b(refus|abort|cannot|declin)/i.test(text) ? OUTCOMES.REFUSED : OUTCOMES.WARNED;
  }

  if (!returnedDeleted) {
    // Returning nothing avoids phantoms without demonstrating any awareness, so it
    // is recorded separately rather than credited as correct exclusion.
    return text.trim().length === 0 ? OUTCOMES.EMPTY : OUTCOMES.CLEAN;
  }
  // A provider holding no index reads the tree live, so a mention means the file
  // still exists rather than that a phantom was served.
  return holdsIndex ? OUTCOMES.PHANTOM : OUTCOMES.CLEAN;
}

export function probeStaleness({ repo, cases, runners, worktreeRoot, snapshotRoot }) {
  mkdirSync(worktreeRoot, { recursive: true });
  mkdirSync(snapshotRoot, { recursive: true });
  const results = [];
  for (const [providerId, runner] of runners) {
    for (const entry of cases) {
      const worktree = join(
        worktreeRoot,
        `probe-${providerId}-${entry.deletion_commit.slice(0, 8)}`
      );
      const snapshot = join(
        snapshotRoot,
        `${providerId}-${entry.deletion_commit.slice(0, 8)}.json`
      );
      rmSync(worktree, { recursive: true, force: true });
      let outcome = OUTCOMES.UNAVAILABLE;
      let detail = null;
      try {
        tryRun('git', [
          '-C',
          repo,
          'worktree',
          'add',
          '--detach',
          '--force',
          worktree,
          entry.indexed_revision,
        ]);
        if (!existsSync(join(worktree, entry.deleted_path))) {
          detail = 'target file absent at indexed revision';
        } else {
          const indexed = runner.index({ worktree, revision: entry.indexed_revision, snapshot });
          if (indexed.ok === false) {
            detail = 'index step failed';
          } else {
            // The tree moves under the index. Nothing is re-indexed on purpose.
            tryRun('git', ['-C', worktree, 'checkout', '--force', entry.deletion_commit]);
            const stillPresent = existsSync(join(worktree, entry.deleted_path));
            if (stillPresent) {
              detail = 'checkout did not remove the file';
            } else {
              const { output } = runner.query({ worktree, query: entry.query, snapshot });
              outcome = classify({
                output,
                deletedPath: entry.deleted_path,
                holdsIndex: runner.holds_index,
              });
            }
          }
        }
      } finally {
        rmSync(worktree, { recursive: true, force: true });
        rmSync(snapshot, { force: true });
        tryRun('git', ['-C', repo, 'worktree', 'prune']);
      }
      results.push({
        provider_id: providerId,
        holds_index: runner.holds_index,
        deleted_path: entry.deleted_path,
        query: entry.query,
        indexed_revision: entry.indexed_revision,
        deletion_commit: entry.deletion_commit,
        outcome,
        detail,
      });
    }
  }
  return results;
}

export function summarize(results) {
  const byProvider = new Map();
  for (const row of results) {
    const bucket = byProvider.get(row.provider_id) ?? {
      provider_id: row.provider_id,
      outcomes: {},
      total: 0,
      holds_index: row.holds_index,
    };
    bucket.outcomes[row.outcome] = (bucket.outcomes[row.outcome] ?? 0) + 1;
    bucket.total += 1;
    byProvider.set(row.provider_id, bucket);
  }
  return [...byProvider.values()]
    .map((bucket) => {
      const scored = bucket.total - (bucket.outcomes[OUTCOMES.UNAVAILABLE] ?? 0);
      const phantoms = bucket.outcomes[OUTCOMES.PHANTOM] ?? 0;
      return {
        ...bucket,
        scored,
        // The headline: how often the provider handed back code that no longer exists.
        phantom_rate: scored > 0 ? Math.round((phantoms / scored) * 1000) / 1000 : null,
        detects_staleness:
          (bucket.outcomes[OUTCOMES.REFUSED] ?? 0) + (bucket.outcomes[OUTCOMES.WARNED] ?? 0) > 0,
      };
    })
    .sort((left, right) => (left.phantom_rate ?? 0) - (right.phantom_rate ?? 0));
}

function tryRun(command, args, cwd, cacheDir) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(cwd ? { cwd } : {}),
      ...(cacheDir
        ? { env: { ...process.env, CODESEARCH_DATA_DIR: cacheDir, CODESEARCH_HOME: cacheDir } }
        : {}),
    });
  } catch (error) {
    // git grep exits 1 on no match, which is an answer rather than a failure.
    if (error?.status === 1 && typeof error.stdout === 'string') return error.stdout;
    return null;
  }
}

async function writeJsonAtomic(path, value) {
  const destination = resolve(path);
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, destination);
}

// Flags as a table, matching score.mjs. The if/else chain scored cognitive complexity
// 23 against a ceiling of 20, and a chain is also where a flag's arity goes unstated —
// which is how a boolean flag elsewhere got handed a value and threw.
const FLAG_TARGET = {
  '--repo': 'repo',
  '--graphify': 'graphifyBinary',
  '--codesearch': 'codesearchBinary',
  '--tool': 'fixtureTool',
  '--zoekt': 'zoektBinary',
  '--semble': 'sembleBinary',
  '--cache-dir': 'cacheDir',
  '--out': 'out',
  '--max-cases': 'maxCases',
};

function parseArgs(args) {
  const options = { repo: process.cwd(), maxCases: 5 };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const target = FLAG_TARGET[flag];
    if (!target) throw new Error(`unknown argument: ${flag}`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    index += 1;
    options[target] = target === 'maxCases' ? Number.parseInt(value, 10) : value;
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const cases = findDeletionCases({ repo: options.repo, maxCases: options.maxCases });
    if (cases.length === 0) throw new Error('no code-file deletions found in recent history');
    const runners = providerRunners(options);
    const base = options.cacheDir ?? join(process.cwd(), '.codevetter-staleness');
    const results = probeStaleness({
      repo: options.repo,
      cases,
      runners,
      worktreeRoot: join(base, 'worktrees'),
      snapshotRoot: join(base, 'snapshots'),
    });
    const report = {
      schema_version: STALENESS_SCHEMA_VERSION,
      repository: options.repo.split('/').pop(),
      cases: cases.length,
      providers: summarize(results),
      results,
      method:
        'Index at R, check out R+1 in the same worktree without re-indexing, query for the deleted file. grep holds no index so its phantom rate is 0 by construction.',
    };
    if (options.out) await writeJsonAtomic(options.out, report);
    process.stdout.write(
      `Deletion cases: ${cases.length}\n` +
        `${'provider'.padEnd(32)}scored  phantom  detects-staleness\n` +
        report.providers
          .map(
            (row) =>
              `${row.provider_id.padEnd(32)}${String(row.scored).padStart(6)}  ${String(
                row.phantom_rate === null ? 'n/a' : `${(row.phantom_rate * 100).toFixed(0)}%`
              ).padStart(7)}  ${row.detects_staleness ? 'yes' : 'no'}`
          )
          .join('\n') +
        '\n'
    );
  } catch (error) {
    process.stderr.write(
      `Staleness probe failed: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 2;
  }
}
