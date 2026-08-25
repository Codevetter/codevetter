#!/usr/bin/env node

// Scores provider retrieval against what real fixes had to touch. Deterministic,
// local, no agent and no model in the loop. Strata are reported separately because
// an average over easy and hard cases hides the only interesting result: whether
// a provider finds what plain search could not.

import { readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { retrieveAgentDefault, retrieveByFilename } from './adapters/agent-default.mjs';
import { createStructuralGraphAdapter } from './adapters/codevetter-graph.mjs';
import {
  retrieveByChurn,
  retrieveRandomCodeFiles,
  retrieveRandomFiles,
} from './adapters/controls.mjs';
import { createCodesearchAdapter } from './adapters/codesearch.mjs';
import { createGenericCliAdapter } from './adapters/generic-cli.mjs';
import { createGraphifyAdapter } from './adapters/graphify.mjs';
import { createCliIndexedMcpAdapter } from './adapters/cli-indexed-mcp.mjs';
import { createJcodemunchAdapter } from './adapters/jcodemunch.mjs';
import { createMcpAdapter } from './adapters/mcp-client.mjs';
import { createRepomapperAdapter } from './adapters/repomapper.mjs';
import { createRepomixAdapter } from './adapters/repomix.mjs';
import { retrieveByKeyword } from './adapters/keyword-search.mjs';
import { createRipgrepAdapter } from './adapters/ripgrep.mjs';
import {
  checkControlsLose,
  checkControlsPresent,
  classifyOutcome,
  flagExtremes,
  nominateForAudit,
} from './gates.mjs';
import { guardMemory } from './probe-candidates.mjs';
import { planFixedIndex, protocolFor, tierFromRevisions } from './tiers.mjs';
import { createResourceMonitor, directoryBytes } from './resources.mjs';

export const RETRIEVAL_SCORE_SCHEMA_VERSION = 'codevetter.context-retrieval-score.v1';
export // Three strikes: enough to distinguish a flake from a tool that cannot index this size.
const ABANDON_AFTER_HARD_FAILURES = 3;

const CUTOFFS = [5, 10, 20];
// recall@k is not comparable across providers: ten whole files and ten excerpts are
// not the same purchase. These budgets ask the question an agent actually faces —
// given this many tokens of context, how much of what I need do I get?
export const TOKEN_BUDGETS = [1_000, 4_000, 16_000];

export function resolveAdapters({
  tool,
  cacheDir,
  worktreeRoot,
  graphifyBinary,
  codesearchBinary,
  codegrokCommand,
  serenaCommand,
  cocoindexCommand,
  jcodemunchCommand,
  repomapper,
  ripgrepBinary,
  cliTools = {},
  repomix = false,
  reuseIndex = false,
} = {}) {
  const adapters = new Map([
    ['keyword-search', retrieveByKeyword],
    // The realistic free baseline: what an agent does before installing anything.
    ['agent-default', retrieveAgentDefault],
    ['filename-match', retrieveByFilename],
    ['random-files', retrieveRandomFiles],
    ['random-code-files', retrieveRandomCodeFiles],
    ['churn-ranked', retrieveByChurn],
  ]);
  if (tool) {
    adapters.set(
      'codevetter-structural-context',
      createStructuralGraphAdapter({ tool, cacheDir, worktreeRoot })
    );
  }
  if (graphifyBinary) {
    adapters.set(
      'graphify',
      createGraphifyAdapter({ binary: graphifyBinary, cacheDir, worktreeRoot })
    );
  }
  if (codesearchBinary) {
    adapters.set(
      'codesearch',
      createCodesearchAdapter({
        binary: codesearchBinary,
        worktreeRoot,
        indexRoot: `${cacheDir}/codesearch-index`,
      })
    );
    // The vendor's own advanced modes, so their claims are testable rather than
    // taken on trust.
    adapters.set(
      'codesearch-rerank',
      createCodesearchAdapter({
        binary: codesearchBinary,
        worktreeRoot,
        indexRoot: `${cacheDir}/codesearch-index`,
        rerank: true,
      })
    );
  }
  if (serenaCommand) {
    // Serena has no semantic search of any kind. Its retrieval surface is LSP
    // symbol lookup, which is a different interface class from a prose query.
    const [bin, ...rest] = serenaCommand.split(' ');
    const headless = [
      '--enable-web-dashboard',
      'False',
      '--open-web-dashboard',
      'False',
      '--enable-gui-log-window',
      'False',
    ];
    adapters.set(
      'serena',
      createMcpAdapter({
        providerId: 'serena',
        command: bin,
        args: [...rest, ...headless],
        // The ide-assistant context exposes only symbol tools — no
        // search_for_pattern, and no semantic search anywhere. find_symbol with
        // substring matching is the sole entry point that accepts free text, so the
        // most distinctive query token is used as the symbol-name probe.
        toolName: 'find_symbol',
        buildArguments: ({ query, queryTokens }) => {
          const longest = [...(queryTokens ?? [])].sort((a, b) => b.length - a.length)[0];
          return {
            name_path: longest ?? query.split(' ')[0],
            substring_matching: true,
            include_body: false,
          };
        },
        timeoutMs: 240_000,
      })
    );
  }
  if (cocoindexCommand) {
    // Indexes from the CLI and answers over MCP `search`. Its wheel omits
    // sentence-transformers, so this arm only exists once that is installed.
    adapters.set(
      'cocoindex-code',
      createCliIndexedMcpAdapter({
        providerId: 'cocoindex-code',
        indexCommand: cocoindexCommand,
        buildIndexArgs: () => ['index'],
        serveCommand: `${cocoindexCommand} serve`,
        toolName: 'search',
        buildArguments: ({ query, limit }) => ({ query, limit }),
        worktreeRoot,
        createMcpAdapter,
      })
    );
  }
  if (jcodemunchCommand) {
    // Judging by tool name alone would have wrongly recorded this server as having
    // no retrieval interface: its six verbs are order/menu/route, and search_symbols
    // is one of 91 catalog actions reached through `order`.
    adapters.set(
      'jcodemunch',
      createJcodemunchAdapter({
        command: jcodemunchCommand,
        worktreeRoot,
        createMcpAdapter,
      })
    );
  }
  if (codegrokCommand) {
    adapters.set(
      'codegrok',
      createMcpAdapter({
        providerId: 'codegrok',
        command: codegrokCommand,
        toolName: 'get_sources',
        indexToolName: 'learn',
        buildIndexArguments: ({ root }) => ({ path: root }),
        buildArguments: ({ query, limit }) => ({ question: query, n_results: limit }),
      })
    );
  }
  if (ripgrepBinary) {
    adapters.set('ripgrep', createRipgrepAdapter({ binary: ripgrepBinary, worktreeRoot }));
  }
  // Config-driven CLI tools: one adapter, one entry each.
  const cliSpecs = {
    // zoekt indexes with a separate binary and the flag is -index, not -index_dir.
    zoekt: (bin) => ({
      binary: bin,
      indexBinary: `${bin}-index`,
      indexArgs: ({ worktree, indexRoot }) => ['-index', indexRoot, worktree],
      queryArgs: ({ indexRoot, queryTokens, query }) => {
        const tokens = [...(queryTokens ?? [])].slice(0, 8);
        const terms = tokens.length > 0 ? tokens : [query.split(' ')[0]];
        return terms.map((token) => ['-index_dir', indexRoot, '-l', token]);
      },
      payloadKind: 'whole-files',
    }),
    // GitNexus indexes into <repo>/.gitnexus, so deleting the worktree collects the
    // index. --index-only stops it writing AGENTS.md and skill files into the tree
    // under test. Embeddings are opt-in and left off: that is the default a user
    // gets, and turning them on would measure a model rather than the graph.
    gitnexus: (bin) => ({
      binary: bin,
      indexArgs: ({ worktree }) => [
        'analyze',
        worktree,
        '--index-only',
        '--skip-skills',
        '--skip-agents-md',
        '--name',
        worktree.split('/').pop(),
        '--allow-duplicate-name',
      ],
      // Without --content the payload is execution flows carrying no filePath at
      // all, so this is the only mode whose results an agent could actually open.
      // -l bounds processes rather than files, so the file count per query varies.
      queryArgs: ({ worktree, query, limit }) => [
        'query',
        '-q',
        query,
        '-r',
        worktree.split('/').pop(),
        '-l',
        String(limit),
        '--content',
      ],
      payloadKind: 'tool-output',
    }),
    // token-savior has two retrieval surfaces and they are different mechanisms, so
    // they are separate arms rather than one averaged number. `use` sets a global
    // active project, which is shared mutable state: correct only because providers
    // and cases run strictly sequentially here.
    //
    // Semantic mode needs sqlite-vec and fastembed, neither of which the wheel
    // pulls. Results are symbols with scores, not files — the cheapest payload of
    // any arm that answers in natural language.
    'token-savior': (bin) => ({
      binary: bin,
      indexArgs: ({ worktree }) => ['--no-daemon', 'use', worktree],
      queryArgs: ({ query, limit }) => [
        '--no-daemon',
        'search',
        '--semantic',
        query,
        '--limit',
        String(limit),
      ],
      payloadKind: 'tool-output',
    }),
    // Regex mode: prose is not a regex, so each token is searched and the hits
    // unioned, exactly as ast-grep and the git-grep baseline are adapted. It indexes
    // prose files too, so CHANGELOG hits are expected and are charged for.
    'token-savior-regex': (bin) => ({
      binary: bin,
      indexArgs: ({ worktree }) => ['--no-daemon', 'use', worktree],
      queryArgs: ({ queryTokens, query, limit }) => {
        const tokens = [...(queryTokens ?? [])].slice(0, 8);
        const terms = tokens.length > 0 ? tokens : [query.split(' ')[0]];
        return terms.map((token) => ['--no-daemon', 'search', token, '--limit', String(limit)]);
      },
      payloadKind: 'tool-output',
    }),
    // The only provider in this registry that takes an explicit token budget, which
    // is the axis this benchmark had to invent to compare the others. It is given
    // 16k, the widest budget scored, and the scorer truncates down from there — so
    // the tool is asked for its best 16k and judged at 1k, 4k and 16k on that.
    //
    // `context` also takes the task in prose via --task, so no query rewriting is
    // needed. --index points the daemon at the worktree, so revisions are real
    // checkouts rather than labels.
    gortex: (bin) => ({
      binary: bin,
      indexArgs: ({ worktree }) => ['track', worktree, '--no-progress'],
      queryArgs: ({ worktree, query, limit }) => [
        'context',
        '--task',
        query,
        '--index',
        worktree,
        '--token-budget',
        '16000',
        '--max-symbols',
        String(limit),
        '--format',
        'json',
        '--no-progress',
      ],
      payloadKind: 'tool-output',
    }),
    // Graph-backed, and the graph is shared across every repository it has indexed,
    // so each case deletes its own worktree afterwards. COLUMNS is forced wide
    // because the output is a Rich table that otherwise wraps each path across four
    // lines mid-token, which no path parser can reassemble.
    //
    // `find content` is full-text, and a prose phrase matches nothing, so each query
    // token is searched separately and the hits unioned — the same adaptation used
    // for ast-grep, ripgrep and the git-grep baseline.
    'code-graph-context': (bin) => ({
      binary: bin,
      // ALLOW_DB_DELETION is what makes the per-case cleanup below actually run. Without
      // it `cgc delete <path> --yes` exits with "Repository deletion is disabled. Set
      // ALLOW_DB_DELETION=true in config to enable" — a refusal the adapter treated as a
      // completed cleanup, so the shared graph grew for 108 cases straight. It is set as
      // a process variable here rather than written into ~/.codegraphcontext/.env: the
      // harness should not be editing a tool's user configuration to measure it.
      env: { COLUMNS: '400', TERM: 'dumb', NO_COLOR: '1', ALLOW_DB_DELETION: 'true' },
      indexArgs: ({ worktree }) => ['index', worktree],
      queryArgs: ({ queryTokens, query }) => {
        const tokens = [...(queryTokens ?? [])].slice(0, 8);
        const terms = tokens.length > 0 ? tokens : [query.split(' ')[0]];
        return terms.map((token) => ['find', 'content', token]);
      },
      // Per case, or the shared graph accumulates every revision it has ever seen. After
      // one 108-case run it held 110 stale worktree paths, and because the database is
      // shared across repositories those copies won the result slots: a hand query for
      // "dnsCache" returned 20 matches of which 19 pointed into earlier cases'
      // worktrees. The adapter correctly discarded them as absent at this revision,
      // which left nothing, so the arm recorded 0.0% on all 108 cases with a
      // 961-function graph built and working.
      cleanupArgs: ({ worktree }) => ['delete', worktree, '--yes'],
      payloadKind: 'tool-output',
    }),
    // RepoWise (AGPL repowise-dev/repowise, ~6.2k stars). Wrongly excluded earlier:
    // the exclusion applied to the separate `repowise-npm` package, which calls
    // api.repowise.ai. This project is local-first — `init` needs no API key and the
    // docs state source never leaves the network — so it is measurable. Telemetry is
    // opt-out and was disabled before measuring.
    //
    // Mechanism is distinct from every other arm: `init` generates a wiki (222 pages
    // on gin) and `search` queries those pages, so it retrieves through generated
    // documentation rather than from code directly. Results still carry real source
    // paths, so it stays comparable on the same metric.
    repowise: (bin) => ({
      binary: bin,
      // --no-prose renders the wiki from structure with no model and no key, which is
      // the only variant this benchmark can run under its local-only constraint. This
      // spec was declared TWICE in this object; the second declaration silently won, so
      // repowise actually ran without --limit and without --format json — an arm
      // measured under different settings than the ones recorded here.
      indexArgs: ({ worktree }) => ['init', worktree, '--no-prose'],
      // hybrid is its own default-recommended blend of fulltext, semantic and symbol
      // modes; the alternatives are recorded rather than cherry-picked.
      queryArgs: ({ query, limit }) => [
        'search',
        query,
        '--mode',
        'hybrid',
        '--limit',
        String(limit),
        '--format',
        'json',
        '--no-workspace',
      ],
      payloadKind: 'tool-output',
    }),
    // codegraph (colbymchenry, 67.7k stars, MIT). The largest project in this category
    // and absent from the registry until an independent sweep found it: best-match
    // ordering never reached it, and it carries no GitHub topics so topic queries were
    // blind to it. Fully local — SQLite, no API keys.
    codegraph: (bin) => ({
      binary: bin,
      indexArgs: ({ worktree }) => ['init', worktree],
      // `explore` is the prose entry point (it backs the codegraph_explore MCP tool);
      // `query` is symbol-name lookup, which is a different question.
      // No --limit: `explore` bounds output with --max-files instead.
      queryArgs: ({ worktree, query, limit }) => [
        'explore',
        query,
        '--path',
        worktree,
        '--max-files',
        String(limit),
      ],
      payloadKind: 'tool-output',
    }),
    // graft (NanoNets, 4.3k stars, MIT). `build` is explicitly model-free; --deep LLM
    // summaries are opt-in and deliberately not used, so this measures the structural
    // graph rather than a model. Telemetry disabled before measuring.
    graft: (bin) => ({
      binary: bin,
      indexArgs: ({ worktree }) => ['build', worktree],
      queryArgs: ({ worktree, query }) => ['ask', query, worktree],
      payloadKind: 'tool-output',
    }),
    // ck (BeaconBay, 1.7k stars, Apache-2.0). Semantic grep, local embeddings. Indexes
    // on first query, so there is no separate index step to charge.
    ck: (bin) => ({
      binary: bin,
      // --sem not --hybrid: --hybrid silently degraded to semantic-only here and printed
      // a banner claiming otherwise. Paths come back absolute under "file", which the
      // worktree-prefix strip already handles.
      queryArgs: ({ worktree, query, limit }) => [
        '--json',
        '--sem',
        query,
        '--limit',
        String(limit),
        worktree,
      ],
      payloadKind: 'tool-output',
    }),
    // chunkhound (1.4k stars, MIT). Regex path works without a key; semantic needs a
    // local embedding endpoint, so the key-free regex mode is what is measured and the
    // limitation is recorded rather than worked around.
    chunkhound: (bin) => ({
      binary: bin,
      indexArgs: ({ worktree }) => ['index', worktree],
      // `search` takes query and path positionally; without the path it looks for a
      // database in the cwd and errors with "Database not found".
      queryArgs: ({ worktree, query, limit }) => [
        'search',
        '--regex',
        query,
        worktree,
        '--page-size',
        String(limit),
      ],
      payloadKind: 'tool-output',
    }),
    'ast-grep': (bin) => ({
      binary: bin,
      // No prose entry point exists, so each query token becomes a literal pattern
      // and the matches are unioned: AST-aware keyword search.
      queryArgs: ({ queryTokens }) =>
        [...queryTokens]
          .slice(0, 8)
          .map((token) => ['run', '-p', token, '--heading', 'never', '.']),
      payloadKind: 'whole-files',
    }),
    'code-review-graph': (bin) => ({
      binary: bin,
      // --repo, not --path. --embedding-provider must be paired with
      // --embedding-model, so both are omitted: the structural build needs neither.
      // `search` takes no --data-dir and reads the registered repo for the cwd.
      indexArgs: ({ worktree }) => ['build', '--repo', worktree],
      // One invocation per query token, not one for the whole sentence. `search` is a
      // whole-string FTS match: on a real corpus query the single term "dnsCache"
      // returns 17 nodes and "cache" returns 20, while the commit subject it came from,
      // "Fix `dnsCache: true` having no effect", returns ZERO. Passing the sentence
      // scored this tool 0.0% on all 108 cases with a graph of 3,174 nodes built and
      // working — a misuse of the tool recorded as a property of it.
      queryArgs: ({ query, queryTokens, limit }) => {
        const terms = queryTokens?.length ? queryTokens : [query];
        return terms.map((term) => ['search', term, '--limit', String(limit)]);
      },
      payloadKind: 'tool-output',
    }),
    ugrep: (bin) => ({
      binary: bin,
      // Same shape as the ripgrep and git-grep arms: one pass per token, unioned.
      queryArgs: ({ queryTokens, query }) => {
        const terms = [...(queryTokens ?? [])].slice(0, 8);
        const list = terms.length > 0 ? terms : [query.split(' ')[0]];
        const types = ['-Ots', '-Otsx', '-Ojs', '-Omjs', '-Opy', '-Ogo', '-Ors'];
        return list.map((token) => ['-l', '-i', '-F', ...types, token, '.']);
      },
      payloadKind: 'whole-files',
    }),
    seagoat: (bin) => ({
      binary: bin,
      // Requires a seagoat-server analysing the repo; without one it errors, which
      // the harness records rather than masking.
      queryArgs: ({ query, worktree }) => [query, worktree],
      payloadKind: 'chunks',
    }),
    semble: (bin) => ({
      binary: bin,
      // Indexes lazily on first search; --content code keeps it to source files.
      queryArgs: ({ query, limit }) => [
        'search',
        query,
        '--top-k',
        String(limit),
        '--content',
        'code',
      ],
      payloadKind: 'chunks',
    }),
    'cocoindex-code': (bin) => ({
      binary: bin,
      indexArgs: ({ worktree }) => [['init', worktree], ['index']],
      queryArgs: ({ query, limit }) => ['search', query, '--limit', String(limit)],
      payloadKind: 'chunks',
    }),
    grepai: (bin) => ({
      binary: bin,
      indexArgs: () => ['init'],
      queryArgs: ({ query }) => ['search', query],
      payloadKind: 'chunks',
    }),
  };
  for (const [id, binary] of Object.entries(cliTools)) {
    const make = cliSpecs[id];
    if (!make || !binary) continue;
    adapters.set(
      id,
      createGenericCliAdapter({
        providerId: id,
        worktreeRoot,
        indexRoot: `${cacheDir}/${id}-index`,
        reuseIndex,
        ...make(binary),
      })
    );
  }
  if (repomapper) {
    for (const personalize of [false, true]) {
      const adapter = createRepomapperAdapter({
        python: repomapper.python,
        script: repomapper.script,
        worktreeRoot,
        personalize,
      });
      adapters.set(personalize ? 'repomap-personalized' : 'repomap-global', adapter);
    }
  }
  if (repomix) {
    adapters.set('repomix-pack-all', createRepomixAdapter({ worktreeRoot }));
    adapters.set('repomix-compressed', createRepomixAdapter({ worktreeRoot, compress: true }));
  }
  return adapters;
}

// A capacity refusal is as hard as an index failure: retrying cannot make a snapshot
// smaller than the ceiling that rejected it.
export function isHardFailure(reason) {
  return /^(index|worktree)|exceeds?[- ].*limit|import[- ]limit|safety limit/i.test(reason ?? '');
}

// One arm over the whole corpus. Split out of scoreRetrieval, which scored cognitive
// complexity 38 against a ceiling of 20.
//
// A provider that has failed to index the same repository several times running will
// keep failing, and each failure costs a full call timeout — one arm burned roughly 55
// minutes proving a repository unindexable 11 times at 5 minutes apiece. Abandon the arm
// instead and record why, so the skip is never mistaken for a score. Consecutive rather
// than cumulative: a provider that recovers continues.
async function runArm({ adapter, corpus, repo, limit, shuffleQueries, indexRevision }) {
  const cases = [];
  let consecutiveHardFailures = 0;
  let lastHardFailure = null;
  let abandoned = null;
  for (const [index, entry] of corpus.cases.entries()) {
    if (abandoned) break;
    // Deliberate mismatch under shuffleQueries: the query belongs to a different case,
    // the revision still belongs to this one. A provider that ignores the query scores
    // the same either way, which is the point of the arm.
    const source = shuffleQueries ? corpus.cases[(index + 1) % corpus.cases.length] : entry;
    // Awaited because MCP-backed providers are asynchronous; synchronous adapters
    // resolve immediately.
    const response = await adapter({
      repo,
      revision: indexRevision ?? entry.base_revision,
      query: source.query,
      queryTokens: source.query_tokens,
      limit,
    });
    cases.push({ case: entry, response, measures: measureCase(entry, response) });
    if (isHardFailure(response.unavailable_reason)) {
      consecutiveHardFailures += 1;
      lastHardFailure = response.unavailable_reason;
    } else {
      consecutiveHardFailures = 0;
      lastHardFailure = null;
    }
    if (consecutiveHardFailures >= ABANDON_AFTER_HARD_FAILURES) {
      abandoned = {
        after_cases: cases.length,
        remaining: corpus.cases.length - cases.length,
        reason: `${consecutiveHardFailures} consecutive hard failures; last failure: ${lastHardFailure}`,
      };
    }
  }
  return { cases, abandoned };
}

// Outcome taxonomy per provider. Kept separate from the score so that did-not-install
// can never read as poor retrieval: more candidates in this category fail to start than
// score badly, and collapsing the two is the largest distortion available here.
function tagOutcomes(providers) {
  for (const provider of providers) {
    const counts = {};
    for (const entry of provider.cases) {
      const outcome = classifyOutcome(entry.response);
      counts[outcome] = (counts[outcome] ?? 0) + 1;
    }
    provider.outcomes = counts;
  }
}

// Travels with every artifact, so a number cannot be quoted without them.
function limitationsFor(gates, aborted) {
  const limitations = [];
  if (!gates.trustworthy) {
    const why = [gates.controls_present.reason, gates.controls_lose.reason]
      .filter(Boolean)
      .join(' ');
    limitations.push(`RELIABILITY GATE FAILED — do not publish these numbers: ${why}`);
  }
  if (aborted) {
    limitations.push(
      `Run aborted by the memory guard after ${aborted.after.length} providers; ${aborted.skipped.length} were not measured.`
    );
  }
  limitations.push(
    'One repository; results describe this codebase, not codebases in general.',
    'Ground truth is the pre-existing files a real fix changed, which is a proxy for the files it had to find.',
    'Commit subjects were written with the fix in hand, so queries are friendlier than real user prompts.',
    'Retrieval quality is not task success; a provider can retrieve well and still not help an agent.'
  );
  return limitations;
}

export function validateRetrievalCorpus(corpus) {
  if (corpus?.schema_version !== 'codevetter.context-retrieval-corpus.v2') {
    throw new Error(
      'Corpus must use codevetter.context-retrieval-corpus.v2; rebuild it so post-fix-only paths cannot enter pre-fix ground truth'
    );
  }
  if (
    !Array.isArray(corpus.cases) ||
    corpus.cases.some((entry) => !Array.isArray(entry.created_files))
  ) {
    throw new Error('Corpus v2 cases must record created_files');
  }
  return corpus;
}

export function planScoreExecution({ repo, corpus }) {
  const tierEvidence = tierFromRevisions(
    repo,
    corpus.cases.map((entry) => entry.base_revision),
    { sample: corpus.cases.length }
  );
  if (!tierEvidence.ok) throw new Error(`Could not assign score tier: ${tierEvidence.reason}`);
  if (tierEvidence.spans_tiers) {
    throw new Error(`Corpus spans tiers and must be split: ${tierEvidence.spans_tiers.join(', ')}`);
  }
  const protocol = protocolFor(tierEvidence.tier);
  if (protocol !== 'fixed-index') {
    return { tier_evidence: tierEvidence, protocol, cases: corpus.cases, rejected: [] };
  }
  const fixed = planFixedIndex({ repo, cases: corpus.cases });
  if (!fixed.ok) throw new Error(`Could not plan fixed-index score: ${fixed.reason}`);
  return {
    tier_evidence: tierEvidence,
    protocol,
    index_revision: fixed.index_revision,
    cases: fixed.admitted,
    rejected: fixed.rejected,
  };
}

export async function scoreRetrieval({
  corpus,
  repo,
  providerIds = ['keyword-search'],
  limit = 20,
  adapters = resolveAdapters(),
  shuffleQueries = false,
  cacheDir,
  minFreeMemoryMb = 3072,
  execution = planScoreExecution({ repo, corpus }),
}) {
  const providers = [];
  const provider_abandoned = new Map();
  let aborted = null;
  for (const providerId of providerIds) {
    const adapter = adapters.get(providerId);
    if (!adapter) throw new Error(`no retrieval adapter registered for "${providerId}"`);
    // Checked before EVERY provider, not once at startup. One arm alone peaks at 3.1 GB
    // indexing a 168-file repository, so a run that was safe to begin can become unsafe
    // midway. Abort with partial results rather than take the machine down.
    const guard = guardMemory({ minFreeMb: minFreeMemoryMb });
    if (!guard.ok) {
      aborted = {
        after: providers.map((entry) => entry.provider_id),
        skipped: providerIds.slice(providerIds.indexOf(providerId)),
        reason: `free memory ${guard.free_mb} MB below the ${guard.minimum_mb} MB floor`,
      };
      break;
    }
    const monitor = createResourceMonitor();
    const cacheBefore = cacheDir ? directoryBytes(cacheDir) : 0;
    const { cases, abandoned } = await runArm({
      adapter,
      corpus: { ...corpus, cases: execution.cases },
      repo,
      limit,
      shuffleQueries,
      indexRevision: execution.index_revision,
    });
    if (abandoned) provider_abandoned.set(providerId, abandoned);
    const resources = monitor.stop();
    providers.push({
      provider_id: providerId,
      cases,
      resources: {
        ...resources,
        index_bytes_added: cacheDir ? Math.max(0, directoryBytes(cacheDir) - cacheBefore) : null,
      },
    });
  }
  if (providers.length === 0) {
    throw new Error(`no provider ran: ${aborted?.reason ?? 'empty provider list'}`);
  }
  // Difficulty is defined by what the reference baseline actually failed to find,
  // not by guessing in advance. The first provider is the reference.
  const baselineMissed = new Set(
    providers[0].cases
      .filter((entry) => entry.measures.recall_at_10 < 1)
      .map((entry) => entry.case.case_id)
  );
  for (const provider of providers) provider.summary = summarize(provider.cases, baselineMissed);

  // Gates run before the report is assembled, so a run that cannot be trusted says
  // so in its own artifact instead of looking like every other run.
  const summarised = providers.map((p) => ({ provider_id: p.provider_id, summary: p.summary }));
  const controlsPresent = checkControlsPresent(providers.map((p) => p.provider_id));
  const controlsLose = controlsPresent.ok
    ? checkControlsLose({ providers: summarised })
    : { ok: null };
  const gates = {
    controls_present: controlsPresent,
    controls_lose: controlsLose,
    // Extreme values are claims about the instrument until a human reads the bytes.
    needs_raw_payload_check: flagExtremes(summarised),
    // The plausible middle is where bias hides and where nothing else looks.
    nominated_for_hand_audit: nominateForAudit({ providers }),
    trustworthy: controlsPresent.ok && controlsLose.ok !== false,
  };
  tagOutcomes(providers);

  return {
    schema_version: RETRIEVAL_SCORE_SCHEMA_VERSION,
    repository: corpus.repository,
    // Measured, not declared: the reporter groups on this, and a hand-set tier is
    // exactly how a benchmark ends up with a repository filed under the tier that
    // flatters it.
    tier: execution.tier_evidence.tier,
    tier_code_files: execution.tier_evidence.median_code_files,
    tier_evidence: execution.tier_evidence,
    protocol: execution.protocol,
    ...(execution.index_revision ? { index_revision: execution.index_revision } : {}),
    ...(execution.rejected.length > 0 ? { protocol_rejected: execution.rejected } : {}),
    corpus_counts: {
      ...corpus.counts,
      cases: execution.cases.length,
      multi_file: execution.cases.filter((entry) => entry.required_files.length > 1).length,
    },
    cutoffs: CUTOFFS,
    gates,
    providers: providers.map((provider) => ({
      provider_id: provider.provider_id,
      summary: provider.summary,
      outcomes: provider.outcomes,
      ...(provider_abandoned.has(provider.provider_id)
        ? { abandoned: provider_abandoned.get(provider.provider_id) }
        : {}),
      resources: provider.resources,
    })),
    ...(aborted ? { aborted } : {}),
    limitations: limitationsFor(gates, aborted),
    cases: providers.flatMap((provider) =>
      provider.cases.map((entry) => ({
        provider_id: provider.provider_id,
        case_id: entry.case.case_id,
        path_leak: entry.case.retrieval.path_leak,
        required_files: entry.case.required_files,
        ...entry.measures,
        tokens_delivered: entry.response.tokens_delivered,
        latency_ms: entry.response.latency_ms,
        indexed_revision_matches:
          entry.response.indexed_revision ===
          (execution.index_revision ?? entry.case.base_revision),
      }))
    ),
  };
}

export function measureCase(entry, response) {
  const required = new Set(entry.required_files);
  const measures = { found: [], missed: [] };
  for (const cutoff of CUTOFFS) {
    const window = response.files.slice(0, cutoff);
    const hit = window.filter((path) => required.has(path));
    measures[`recall_at_${cutoff}`] = round(hit.length / required.size);
    measures[`precision_at_${cutoff}`] =
      window.length === 0 ? 0 : round(hit.length / window.length);
  }
  for (const budget of TOKEN_BUDGETS) {
    const window = affordablePrefix(response, budget);
    measures[`recall_at_${budget}_tokens`] = round(
      window.filter((path) => required.has(path)).length / required.size
    );
  }
  const all = response.files.filter((path) => required.has(path));
  measures.found = all.sort();
  measures.missed = [...required].filter((path) => !response.files.includes(path)).sort();
  // Rank of the first correct file: what an agent would actually pay to read past.
  const firstHit = response.files.findIndex((path) => required.has(path));
  measures.first_hit_rank = firstHit === -1 ? null : firstHit + 1;
  return measures;
}

function affordablePrefix(response, budget) {
  if (response.files.length === 0) return [];
  const rankedCosts = response.ranking?.map((entry) => entry.tokens);
  if (
    rankedCosts?.length === response.files.length &&
    rankedCosts.every((tokens) => Number.isFinite(tokens) && tokens > 0)
  ) {
    let spent = 0;
    let affordable = 0;
    for (const tokens of rankedCosts) {
      if (spent + tokens > budget) break;
      spent += tokens;
      affordable += 1;
    }
    return response.files.slice(0, affordable);
  }
  const total = response.tokens_delivered;
  return Number.isFinite(total) && total > 0 && total <= budget ? response.files : [];
}

function summarize(cases, baselineMissed) {
  const strata = {
    all: cases,
    // What the baseline could not fully locate: the only stratum where a context
    // provider can demonstrate it adds anything.
    baseline_missed: cases.filter((entry) => baselineMissed.has(entry.case.case_id)),
    baseline_solved: cases.filter((entry) => !baselineMissed.has(entry.case.case_id)),
    path_leak: cases.filter((entry) => entry.case.retrieval.path_leak),
    no_path_leak: cases.filter((entry) => !entry.case.retrieval.path_leak),
  };
  const summary = {};
  for (const [name, group] of Object.entries(strata)) {
    summary[name] = {
      cases: group.length,
      ...Object.fromEntries(
        CUTOFFS.flatMap((cutoff) => [
          [
            `mean_recall_at_${cutoff}`,
            mean(group.map((entry) => entry.measures[`recall_at_${cutoff}`])),
          ],
          [
            `full_recall_at_${cutoff}`,
            round(
              group.filter((entry) => entry.measures[`recall_at_${cutoff}`] === 1).length /
                (group.length || 1)
            ),
          ],
        ])
      ),
      ...Object.fromEntries(
        TOKEN_BUDGETS.map((budget) => [
          `mean_recall_at_${budget}_tokens`,
          mean(group.map((entry) => entry.measures[`recall_at_${budget}_tokens`])),
        ])
      ),
      mean_precision_at_10: mean(group.map((entry) => entry.measures.precision_at_10)),
      zero_hit_rate: round(
        group.filter((entry) => entry.measures.first_hit_rank === null).length / (group.length || 1)
      ),
      median_tokens_delivered: median(group.map((entry) => entry.response.tokens_delivered)),
      median_latency_ms: median(group.map((entry) => entry.response.latency_ms)),
      // Whole files versus excerpts are not the same currency; never blend them.
      payload_kind: [
        ...new Set(group.map((entry) => entry.response.payload_kind ?? 'whole-files')),
      ].sort(),
      unavailable: group.filter((entry) => entry.response.unavailable_reason).length,
    };
  }
  return summary;
}

export function renderRetrievalScore(score) {
  const lines = [
    `# Retrieval quality — ${score.repository.id}`,
    '',
    `Cases: ${score.corpus_counts.cases} · multi-file ${score.corpus_counts.multi_file} · path-leak ${score.corpus_counts.path_leak}`,
    '',
    `Reference baseline: \`${score.providers[0]?.provider_id}\`. The **baseline missed** row is the stratum that matters — cases the baseline could not fully locate at rank 10.`,
    '',
    '| Provider | Stratum | n | recall@5 | recall@10 | recall@20 | full@10 | prec@10 | never found | payload | tokens | n/a |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: |',
  ];
  for (const provider of score.providers) {
    for (const stratum of [
      'all',
      'baseline_missed',
      'baseline_solved',
      'path_leak',
      'no_path_leak',
    ]) {
      const row = provider.summary[stratum];
      lines.push(
        `| ${provider.provider_id} | ${stratum.replace(/_/g, ' ')} | ${row.cases} | ${pct(row.mean_recall_at_5)} | ${pct(row.mean_recall_at_10)} | ${pct(row.mean_recall_at_20)} | ${pct(row.full_recall_at_10)} | ${pct(row.mean_precision_at_10)} | ${pct(row.zero_hit_rate)} | ${row.payload_kind.join('+')} | ${row.median_tokens_delivered} | ${row.unavailable} |`
      );
    }
  }
  lines.push('', '## Limitations', '', ...score.limitations.map((item) => `- ${item}`));
  return `${lines.join('\n')}\n`;
}

function mean(values) {
  const usable = values.filter((value) => Number.isFinite(value));
  if (usable.length === 0) return 0;
  return round(usable.reduce((total, value) => total + value, 0) / usable.length);
}

function median(values) {
  const usable = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (usable.length === 0) return 0;
  const middle = Math.floor(usable.length / 2);
  return usable.length % 2 === 0
    ? round((usable[middle - 1] + usable[middle]) / 2)
    : usable[middle];
}

function round(value) {
  return Math.round(value * 10000) / 10000;
}

function pct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

async function writeAtomic(path, contents) {
  const destination = resolve(path);
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${process.pid}`;
  await writeFile(temporary, contents);
  await rename(temporary, destination);
}

// Flags as a table rather than a chain of eighteen ifs. The chain scored cognitive
// complexity 45 against a ceiling of 20, and it hid a live bug: --repomix is a boolean,
// so `--repomix true` threw "unknown argument: true" and two arms produced nothing at
// all on their first run. A table makes a flag's arity part of its declaration.
const BOOLEAN_FLAGS = new Set(['--repomix', '--shuffle-queries']);

const BOOLEAN_TARGET = {
  '--repomix': 'repomix',
  '--shuffle-queries': 'shuffleQueries',
};

const VALUE_TARGET = {
  '--corpus': 'corpusPath',
  '--repo': 'repo',
  '--format': 'format',
  '--out': 'out',
  '--tool': 'tool',
  '--cache-dir': 'cacheDir',
  '--graphify': 'graphifyBinary',
  '--codesearch': 'codesearchBinary',
  '--codegrok': 'codegrokCommand',
  '--serena': 'serenaCommand',
  '--cocoindex': 'cocoindexCommand',
  '--jcodemunch': 'jcodemunchCommand',
  '--repomapper-python': 'repomapperPython',
  '--repomapper-script': 'repomapperScript',
  '--ripgrep': 'ripgrepBinary',
};

function applyValueFlag(options, flag, value) {
  if (flag === '--provider') {
    options.providerIds = value.split(',');
    return;
  }
  if (flag === '--cli-tool') {
    const [id, binary] = value.split('=');
    (options.cliTools ??= {})[id] = binary;
    return;
  }
  options[VALUE_TARGET[flag]] = value;
}

function parseArgs(args) {
  const options = { repo: process.cwd(), providerIds: ['keyword-search'], format: 'markdown' };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (BOOLEAN_FLAGS.has(flag)) {
      options[BOOLEAN_TARGET[flag]] = true;
      continue;
    }
    const takesValue = flag === '--provider' || flag === '--cli-tool' || flag in VALUE_TARGET;
    if (!takesValue) throw new Error(`unknown argument: ${flag}`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    index += 1;
    applyValueFlag(options, flag, value);
  }
  if (!options.corpusPath) throw new Error('--corpus is required');
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const corpus = validateRetrievalCorpus(JSON.parse(readFileSync(options.corpusPath, 'utf8')));
    const execution = planScoreExecution({ repo: options.repo, corpus });
    const adapters = resolveAdapters({
      tool: options.tool,
      cacheDir: options.cacheDir ? `${options.cacheDir}/snapshots` : undefined,
      worktreeRoot: options.cacheDir ? `${options.cacheDir}/worktrees` : undefined,
      graphifyBinary: options.graphifyBinary,
      codesearchBinary: options.codesearchBinary,
      codegrokCommand: options.codegrokCommand,
      serenaCommand: options.serenaCommand,
      cocoindexCommand: options.cocoindexCommand,
      jcodemunchCommand: options.jcodemunchCommand,
      repomapper:
        options.repomapperPython && options.repomapperScript
          ? { python: options.repomapperPython, script: options.repomapperScript }
          : undefined,
      ripgrepBinary: options.ripgrepBinary,
      cliTools: options.cliTools ?? {},
      repomix: options.repomix,
      reuseIndex: execution.protocol === 'fixed-index',
    });
    const score = await scoreRetrieval({
      corpus,
      repo: options.repo,
      providerIds: options.providerIds,
      adapters,
      shuffleQueries: options.shuffleQueries,
      cacheDir: options.cacheDir,
      execution,
    });
    const rendered =
      options.format === 'json'
        ? `${JSON.stringify(score, null, 2)}\n`
        : renderRetrievalScore(score);
    if (options.out) await writeAtomic(options.out, rendered);
    process.stdout.write(rendered);
  } catch (error) {
    process.stderr.write(
      `Retrieval scoring failed: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 2;
  }
}
