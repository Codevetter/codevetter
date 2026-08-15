#!/usr/bin/env node

import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { sha256Bytes } from './contracts.mjs';
import { loadTaskPackage, materializeWorkspace } from './qualify-task.mjs';

const execFile = promisify(execFileCallback);

export async function prepareContextSnapshot({
  root = process.cwd(),
  corpusRoot = 'benchmarks/agent-tasks/sample',
  taskId,
  toolPath,
  outputPath,
  runTool = runSnapshotTool,
} = {}) {
  if (!taskId || !toolPath || !outputPath) {
    throw new Error('taskId, toolPath, and outputPath are required');
  }
  const workspaceRoot = resolve(root);
  const output = insideRoot(workspaceRoot, outputPath, 'output');
  const tool = resolve(toolPath);
  const task = await loadTaskPackage(resolve(workspaceRoot, corpusRoot), taskId);
  await mkdir(dirname(output), { recursive: true });
  let workspace = null;
  try {
    workspace = await materializeWorkspace(task.fixture, task.taskPacket);
    await rm(resolve(workspace, 'TASK.md'));
    await execFile('git', ['init', '--quiet', workspace]);
    const observed = await runTool({
      tool,
      workspace,
      revision: task.manifest.provenance.revision,
      output,
    });
    if (observed.indexed_revision !== task.manifest.provenance.revision) {
      throw new Error('snapshot tool returned a stale indexed revision');
    }
    if (typeof observed.snapshot_id !== 'string' || observed.snapshot_id.length === 0) {
      throw new Error('snapshot tool omitted snapshot identity');
    }
    const bytes = await readFile(output);
    return {
      task_id: taskId,
      source_sha256: task.identities.fixture,
      snapshot_id: observed.snapshot_id,
      indexed_revision: observed.indexed_revision,
      artifact: {
        path: relative(workspaceRoot, output).split(sep).join('/'),
        sha256: sha256Bytes(bytes),
      },
      indexed_files: observed.indexed_files,
      node_count: observed.node_count,
      edge_count: observed.edge_count,
      truncated: observed.truncated,
    };
  } finally {
    if (workspace !== null) await rm(workspace, { recursive: true, force: true });
  }
}

async function runSnapshotTool({ tool, workspace, revision, output }) {
  const { stdout } = await execFile(tool, ['build', workspace, revision, output], {
    maxBuffer: 1024 * 1024,
  });
  return JSON.parse(stdout);
}

function insideRoot(root, path, label) {
  const absolute = resolve(root, path);
  const declared = relative(root, absolute);
  if (declared === '' || declared === '..' || declared.startsWith(`..${sep}`)) {
    throw new Error(`${label} path must be inside the repository root`);
  }
  return absolute;
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!['--task', '--tool', '--out', '--corpus-root'].includes(argument)) {
      throw new Error(`unknown argument: ${argument}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
    index += 1;
    if (argument === '--task') options.taskId = value;
    if (argument === '--tool') options.toolPath = value;
    if (argument === '--out') options.outputPath = value;
    if (argument === '--corpus-root') options.corpusRoot = value;
  }
  return options;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await prepareContextSnapshot(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(
      `Context snapshot failed: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 2;
  }
}
