import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import {
  STATIC_REDUNDANCY_LIMITS,
  inspectStaticRedundancy,
  normalizeJscpdReport,
  normalizeKnipReport,
} from './static-redundancy.mjs';
import { SOURCE_SNAPSHOT_LIMITS } from './git-diff.mjs';
import { createRuntimeMcpHandler, toolDefinitions } from './mcp.mjs';

const execute = promisify(execFile);

test('normalizes Knip output into bounded static candidates without a removal claim', () => {
  const candidates = normalizeKnipReport({
    issues: [
      {
        file: 'src/Card.tsx',
        files: [],
        exports: [{ name: 'LegacyCard', line: 8 }],
        duplicates: [
          [
            { name: 'Card', line: 3 },
            { name: 'LegacyCard', line: 8 },
          ],
        ],
        dependencies: [],
        devDependencies: [],
        optionalPeerDependencies: [],
        nsExports: [],
        types: [],
        nsTypes: [],
        enumMembers: [],
        namespaceMembers: [],
      },
      {
        file: 'src/OldPage.tsx',
        files: [{ name: 'src/OldPage.tsx' }],
        exports: [],
        duplicates: [],
        dependencies: [],
        devDependencies: [],
        optionalPeerDependencies: [],
        nsExports: [],
        types: [],
        nsTypes: [],
        enumMembers: [],
        namespaceMembers: [],
      },
    ],
  });
  assert.deepEqual(
    candidates.map((candidate) => candidate.kind),
    ['duplicate_export_group', 'unused_export_surface', 'unused_file']
  );
  assert.ok(candidates.every((candidate) => candidate.claim === 'static_candidate'));
  assert.ok(
    candidates.every((candidate) => /Reject/.test(candidate.verification.rejection_condition))
  );
});

test('normalizes jscpd clone locations without retaining source fragments', () => {
  const normalized = normalizeJscpdReport(jscpdReport({ fragment: 'sensitive source text' }));
  assert.deepEqual(normalized.coverage, {
    sources: 2,
    lines: 40,
    tokens: 200,
    clone_groups: 1,
    duplicated_lines: 9,
    duplicated_tokens: 83,
    duplication_percentage: 22.5,
  });
  assert.equal(normalized.candidates[0].kind, 'duplicate_implementation_fragment');
  assert.deepEqual(normalized.candidates[0].duplicate_locations, [
    { file: 'src/Card.tsx', start_line: 2, end_line: 10 },
    { file: 'src/LegacyCard.tsx', start_line: 4, end_line: 12 },
  ]);
  assert.doesNotMatch(JSON.stringify(normalized), /sensitive source text/);
});

test('runs only an installed declared project Knip and preserves repository state', async () => {
  const root = await fixture({
    output: {
      issues: [
        {
          file: 'src/Card.tsx',
          files: [],
          exports: [{ name: 'LegacyCard', line: 4 }],
          duplicates: [],
          dependencies: [],
          devDependencies: [],
          optionalPeerDependencies: [],
          nsExports: [],
          types: [],
          nsTypes: [],
          enumMembers: [],
          namespaceMembers: [],
        },
      ],
    },
  });
  const result = await inspectStaticRedundancy(root);
  assert.equal(result.verdict.status, 'candidates');
  assert.equal(result.verdict.safe_to_remove, false);
  assert.equal(result.verdict.repository_mutation_performed, false);
  assert.equal(result.analyzer.invocation.shell, false);
  assert.equal(result.analyzer.invocation.read_only, true);
  assert.equal(result.analyzer.configuration.path, 'knip.json');
  assert.equal(result.candidates[0].symbol, 'LegacyCard');
  assert.deepEqual((await gitStatus(root)).trim(), '');
});

test('does not install or fall back when project-owned Knip is unavailable', async () => {
  const root = await fixture({ installKnip: false });
  const result = await inspectStaticRedundancy(root);
  assert.equal(result.verdict.status, 'unavailable');
  assert.equal(result.verdict.reason, 'project_owned_static_analyzers_unavailable');
  assert.equal(result.analyzer.executable, null);
  assert.equal(result.clone_analysis.analyzer.executable, null);
  assert.deepEqual(result.analyzer.availability, {
    declared: false,
    installed: false,
    reason: 'not_declared',
    declaration: null,
  });
});

test('distinguishes a declared analyzer from an installed repository executable', async () => {
  const root = await fixture({ declareJscpd: true });
  const result = await inspectStaticRedundancy(root);
  assert.equal(result.verdict.status, 'no_candidates');
  assert.deepEqual(result.clone_analysis.analyzer.availability, {
    declared: true,
    installed: false,
    reason: 'declared_not_installed',
    declaration: 'package.json#devDependencies.jscpd',
  });
  assert.match(result.limitations.join('\n'), /declared by the repository/);
  assert.deepEqual((await gitStatus(root)).trim(), '');
});

test('returns an actionable closed report when the source snapshot inventory is oversized', async () => {
  const root = await fixture();
  await Promise.all(
    Array.from({ length: SOURCE_SNAPSHOT_LIMITS.files + 1 }, (_, index) =>
      writeFile(join(root, `overflow-${index}.ts`), `export const value${index} = ${index};\n`)
    )
  );
  const result = await inspectStaticRedundancy(root);
  assert.equal(result.verdict.status, 'no_confidence');
  assert.equal(result.verdict.reason, 'source_snapshot_changed_file_inventory_exceeded_bound');
  assert.equal(result.subject.source_snapshot_sha256, null);
  assert.equal(result.subject.changed_file_count, SOURCE_SNAPSHOT_LIMITS.files + 1);
  assert.equal(result.subject.changed_file_limit, SOURCE_SNAPSHOT_LIMITS.files);
  assert.equal(result.subject.changed_files_truncated, true);
  assert.deepEqual(result.subject.changed_files, []);
  assert.equal(result.analyzer.status, 'not_run');
  assert.equal(result.clone_analysis.analyzer.status, 'not_run');
  assert.match(result.limitations.join('\n'), /did not run/);
});

test('preserves jscpd evidence when Knip is unavailable', async () => {
  const root = await fixture({ installKnip: false, installJscpd: true });
  const result = await inspectStaticRedundancy(root);
  assert.equal(result.verdict.status, 'candidates');
  assert.equal(result.analyzer.status, 'unavailable');
  assert.equal(result.clone_analysis.analyzer.status, 'ran');
  assert.equal(result.clone_analysis.coverage.clone_groups, 1);
  assert.equal(result.candidates[0].kind, 'duplicate_implementation_fragment');
  assert.doesNotMatch(JSON.stringify(result), /fixture fragment/);
  assert.deepEqual((await gitStatus(root)).trim(), '');
});

test('screens generated Wrangler declarations before ranking application clones', async () => {
  const cloneReport = jscpdReport();
  cloneReport.duplicates.unshift({
    firstFile: { name: 'worker-configuration.d.ts', start: 100, end: 120 },
    secondFile: { name: 'worker-configuration.d.ts', start: 300, end: 320 },
    format: 'typescript',
    fragment: 'generated declaration fragment',
    lines: 21,
    tokens: 100,
  });
  cloneReport.statistics.total.clones = 2;
  const root = await fixture({
    installKnip: false,
    installJscpd: true,
    generatedWranglerTypes: true,
    jscpdOutput: cloneReport,
  });
  const result = await inspectStaticRedundancy(root);
  assert.equal(result.verdict.status, 'candidates');
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].file, 'src/Card.tsx');
  assert.equal(result.screened_out.length, 1);
  assert.equal(result.screened_out[0].screening.reason, 'generated_wrangler_declaration');
  assert.deepEqual(result.screened_out[0].screening.references, ['worker-configuration.d.ts']);
  assert.match(
    result.clone_analysis.analyzer.invocation.arguments.join(' '),
    /worker-configuration\.d\.ts/
  );
  assert.match(result.limitations.join(' '), /Generated Wrangler declarations/);
});

test('screens clones confined to import preambles while retaining implementation bodies', async () => {
  const cloneReport = jscpdReport();
  cloneReport.duplicates.unshift({
    firstFile: { name: 'src/Card.tsx', start: 1, end: 3 },
    secondFile: { name: 'src/LegacyCard.tsx', start: 1, end: 3 },
    format: 'tsx',
    fragment: 'import fragment',
    lines: 3,
    tokens: 61,
  });
  cloneReport.statistics.total.clones = 2;
  const root = await fixture({
    installKnip: false,
    installJscpd: true,
    importPreambleClone: true,
    jscpdOutput: cloneReport,
  });
  const result = await inspectStaticRedundancy(root);
  assert.equal(result.candidates.length, 1);
  assert.deepEqual(result.candidates[0].duplicate_locations, [
    { file: 'src/Card.tsx', start_line: 2, end_line: 10 },
    { file: 'src/LegacyCard.tsx', start_line: 4, end_line: 12 },
  ]);
  assert.equal(result.screened_out.length, 1);
  assert.equal(result.screened_out[0].screening.reason, 'import_preamble_clone');
});

test('ranks a one-sided clone intersection before unchanged debt without an introduction claim', async () => {
  const root = await fixture({
    installJscpd: true,
    dirtyAppend: 'export const Changed = true;\n',
    output: {
      issues: [{ file: 'src/Legacy.tsx', exports: [{ name: 'Legacy', line: 1 }] }],
    },
  });
  const result = await inspectStaticRedundancy(root);
  assert.equal(result.summary.diff_relevant, 1);
  assert.equal(result.candidates[0].kind, 'duplicate_implementation_fragment');
  assert.equal(result.candidates[0].relevance.status, 'changed_line_intersection');
  assert.deepEqual(result.candidates[0].relevance.locations, [
    {
      file: 'src/Card.tsx',
      match: 'changed_line_intersection',
      changed_lines: [2],
      changed_lines_truncated: false,
    },
  ]);
  assert.equal(result.candidates[0].relevance.claim, 'snapshot_correlation_only');
  assert.equal(result.candidates[1].relevance.status, 'unchanged');
});

test('marks an untracked static candidate as file-level relevant without invented lines', async () => {
  const root = await fixture({
    untrackedFile: 'src/NewCopy.tsx',
    output: {
      issues: [{ file: 'src/Card.tsx', files: [{ name: 'src/NewCopy.tsx' }] }],
    },
  });
  const result = await inspectStaticRedundancy(root);
  assert.equal(result.summary.diff_relevant, 1);
  assert.deepEqual(result.candidates[0].relevance, {
    status: 'changed_file',
    locations: [
      {
        file: 'src/NewCopy.tsx',
        match: 'changed_file',
        changed_lines: [],
        changed_lines_truncated: false,
      },
    ],
    claim: 'snapshot_correlation_only',
  });
});

test('screens out an unused-dependency report contradicted by a package script', async () => {
  const root = await fixture({
    packageScripts: { duplication: 'jscpd src --silent' },
    output: {
      issues: [
        {
          file: 'package.json',
          dependencies: [{ name: 'jscpd', line: 20 }],
        },
      ],
    },
  });
  const result = await inspectStaticRedundancy(root);
  assert.equal(result.verdict.status, 'no_candidates');
  assert.deepEqual(result.candidates, []);
  assert.equal(result.screened_out[0].symbol, 'jscpd');
  assert.deepEqual(result.screened_out[0].screening.references, [
    'package.json#scripts.duplication',
  ]);
});

test('fails closed on malformed and escaping analyzer output', async () => {
  const malformed = await fixture({ rawOutput: '{bad json' });
  assert.equal(
    (await inspectStaticRedundancy(malformed)).verdict.reason,
    'analyzer_output_invalid'
  );

  const escaping = await fixture({
    output: {
      issues: [{ file: '../outside.ts', exports: [{ name: 'escape', line: 1 }] }],
    },
  });
  assert.equal((await inspectStaticRedundancy(escaping)).verdict.reason, 'analyzer_output_invalid');
});

test('fails closed when Knip times out or mutates the repository', async () => {
  const timeout = await fixture({ scriptBody: 'setTimeout(() => {}, 10_000);' });
  assert.equal(
    (await inspectStaticRedundancy(timeout, { timeoutMs: 100 })).verdict.reason,
    'analyzer_timeout'
  );

  const mutation = await fixture({
    scriptBody:
      "await import('node:fs/promises').then(({writeFile}) => writeFile('src/Card.tsx', 'changed\\n')); console.log(JSON.stringify({issues:[]}));",
  });
  assert.equal(
    (await inspectStaticRedundancy(mutation)).verdict.reason,
    'repository_changed_during_analysis'
  );
});

test('fails closed on unsafe, timed out, and mutating clone analysis', async () => {
  const escapingReport = jscpdReport();
  escapingReport.duplicates[0].firstFile.name = '../outside.ts';
  const escaping = await fixture({
    installKnip: false,
    installJscpd: true,
    jscpdOutput: escapingReport,
  });
  assert.equal(
    (await inspectStaticRedundancy(escaping)).verdict.reason,
    'clone_analyzer_output_invalid'
  );

  const timeout = await fixture({
    installKnip: false,
    installJscpd: true,
    jscpdScriptBody: 'setTimeout(() => {}, 10_000);',
  });
  assert.equal(
    (await inspectStaticRedundancy(timeout, { timeoutMs: 100 })).verdict.reason,
    'clone_analyzer_timeout'
  );

  const mutation = await fixture({
    installKnip: false,
    installJscpd: true,
    jscpdScriptBody: jscpdScript(jscpdReport(), "await writeFile('src/Card.tsx', 'changed\\n');"),
  });
  assert.equal(
    (await inspectStaticRedundancy(mutation)).verdict.reason,
    'repository_changed_during_analysis'
  );
});

test('rejects clone inventories over the per-analyzer bound', async () => {
  const cloneReport = jscpdReport();
  cloneReport.duplicates = Array.from(
    { length: STATIC_REDUNDANCY_LIMITS.analyzerCandidates + 1 },
    (_, index) => ({
      ...cloneReport.duplicates[0],
      firstFile: { name: `src/First${index}.tsx`, start: 2, end: 10 },
      secondFile: { name: `src/Second${index}.tsx`, start: 4, end: 12 },
    })
  );
  cloneReport.statistics.total.clones = cloneReport.duplicates.length;
  const root = await fixture({
    installKnip: false,
    installJscpd: true,
    jscpdOutput: cloneReport,
  });
  const result = await inspectStaticRedundancy(root);
  assert.equal(result.verdict.reason, 'candidate_inventory_exceeded_bound');
  assert.deepEqual(result.candidates, []);
});

test('rejects an oversized clone report before retaining source fragments', async () => {
  const root = await fixture({
    installKnip: false,
    installJscpd: true,
    jscpdOutput: jscpdReport({ fragment: 'x'.repeat(STATIC_REDUNDANCY_LIMITS.reportBytes) }),
  });
  const result = await inspectStaticRedundancy(root);
  assert.equal(result.verdict.reason, 'clone_analyzer_output_exceeded_bound');
  assert.deepEqual(result.candidates, []);
});

test('rejects an oversized candidate inventory instead of truncating it', async () => {
  const root = await fixture({
    output: {
      issues: [
        {
          file: 'src/Card.tsx',
          exports: Array.from(
            { length: STATIC_REDUNDANCY_LIMITS.analyzerCandidates + 1 },
            (_, index) => ({
              name: `unused${index}`,
              line: index + 1,
            })
          ),
        },
      ],
    },
  });
  const result = await inspectStaticRedundancy(root);
  assert.equal(result.verdict.reason, 'candidate_inventory_exceeded_bound');
  assert.deepEqual(result.candidates, []);
});

test('CLI and MCP expose the same canonical React redundancy operation', async () => {
  const root = await fixture({ output: { issues: [] } });
  const cli = join(import.meta.dirname, 'cli.mjs');
  const { stdout } = await execute(process.execPath, [
    cli,
    'inspect-react-redundancy',
    '--repo',
    root,
    '--json',
  ]);
  const cliResult = JSON.parse(stdout);
  assert.equal(cliResult.schema_version, 'codevetter-static-redundancy/v2');
  assert.equal(cliResult.verdict.status, 'no_candidates');

  const definition = toolDefinitions().find((tool) => tool.name === 'inspect_react_redundancy');
  assert.equal(definition.annotations.readOnlyHint, true);
  assert.equal(definition.inputSchema.additionalProperties, false);
  const handle = await createRuntimeMcpHandler(root, {
    staticRedundancyInspector: async () => cliResult,
  });
  const response = await handle({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'inspect_react_redundancy', arguments: {} },
  });
  assert.deepEqual(response.result.structuredContent.result, cliResult);
});

async function fixture({
  installKnip = true,
  installJscpd = false,
  declareKnip = installKnip,
  declareJscpd = installJscpd,
  output = { issues: [] },
  rawOutput,
  scriptBody,
  jscpdOutput = jscpdReport({ fragment: 'fixture fragment' }),
  jscpdScriptBody,
  packageScripts = {},
  dirtyAppend,
  untrackedFile,
  generatedWranglerTypes = false,
  importPreambleClone = false,
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'codevetter-static-redundancy-'));
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'fixture',
      private: true,
      scripts: packageScripts,
      devDependencies: {
        ...(declareKnip ? { knip: '1.2.3' } : {}),
        ...(declareJscpd ? { jscpd: '5.0.14' } : {}),
      },
    })
  );
  await writeFile(join(root, 'knip.json'), '{"entry":["src/Card.tsx"]}\n');
  await writeFile(
    join(root, 'src', 'Card.tsx'),
    importPreambleClone
      ? "import { shared } from './shared';\n\nexport const Card = () => shared;\n"
      : 'export const Card = () => null;\n'
  );
  if (importPreambleClone) {
    await writeFile(
      join(root, 'src', 'LegacyCard.tsx'),
      "import { shared } from './shared';\n\nexport const LegacyCard = () => shared;\n"
    );
  }
  if (generatedWranglerTypes) {
    await writeFile(
      join(root, 'worker-configuration.d.ts'),
      '/* eslint-disable */\n// Generated by Wrangler by running `wrangler types` (hash: fixture)\n'
    );
  }
  if (installKnip) {
    await mkdir(join(root, 'node_modules', 'knip', 'bin'), { recursive: true });
    await writeFile(
      join(root, 'node_modules', 'knip', 'package.json'),
      JSON.stringify({
        name: 'knip',
        version: '1.2.3',
        type: 'module',
        bin: { knip: 'bin/knip.js' },
      })
    );
    await writeFile(
      join(root, 'node_modules', 'knip', 'bin', 'knip.js'),
      scriptBody ?? `console.log(${JSON.stringify(rawOutput ?? JSON.stringify(output))});`
    );
  }
  if (installJscpd) {
    await mkdir(join(root, 'node_modules', 'jscpd'), { recursive: true });
    await writeFile(
      join(root, 'node_modules', 'jscpd', 'package.json'),
      JSON.stringify({
        name: 'jscpd',
        version: '5.0.14',
        type: 'module',
        bin: { jscpd: 'run-jscpd.js' },
      })
    );
    await writeFile(
      join(root, 'node_modules', 'jscpd', 'run-jscpd.js'),
      jscpdScriptBody ?? jscpdScript(jscpdOutput)
    );
  }
  await execute('git', ['init', '-q'], { cwd: root });
  await execute('git', ['config', 'user.email', 'test@example.test'], { cwd: root });
  await execute('git', ['config', 'user.name', 'CodeVetter Test'], { cwd: root });
  await execute('git', ['add', '.'], { cwd: root });
  await execute('git', ['commit', '-qm', 'fixture'], { cwd: root });
  if (dirtyAppend) {
    const current = await readFile(join(root, 'src', 'Card.tsx'), 'utf8');
    await writeFile(join(root, 'src', 'Card.tsx'), current + dirtyAppend);
  }
  if (untrackedFile) await writeFile(join(root, untrackedFile), 'export const Copy = true;\n');
  return root;
}

function jscpdScript(report, prefix = '') {
  return `import { mkdir, writeFile } from 'node:fs/promises';
${prefix}
const output = process.argv[process.argv.indexOf('--output') + 1];
await mkdir(output, { recursive: true });
await writeFile(new URL('jscpd-report.json', 'file://' + output + '/'), ${JSON.stringify(JSON.stringify(report))});`;
}

function jscpdReport({ fragment = 'duplicate source' } = {}) {
  return {
    duplicates: [
      {
        firstFile: { name: 'src/Card.tsx', start: 2, end: 10 },
        secondFile: { name: 'src/LegacyCard.tsx', start: 4, end: 12 },
        format: 'tsx',
        fragment,
        lines: 9,
        tokens: 83,
      },
    ],
    statistics: {
      total: {
        sources: 2,
        lines: 40,
        tokens: 200,
        clones: 1,
        duplicatedLines: 9,
        duplicatedTokens: 83,
        percentage: 22.5,
      },
    },
  };
}

async function gitStatus(root) {
  const { stdout } = await execute('git', ['status', '--short'], { cwd: root });
  return stdout;
}
