#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

import { qualifyTask, writeQualificationReceipt } from './qualify-task.mjs';

export async function runQualificationCli(args = process.argv.slice(2)) {
  const wantsJson = args.includes('--json');
  try {
    const options = parseArgs(args);
    const receipt = await qualifyTask({ root: options.root, taskId: options.taskId });
    if (options.out) await writeQualificationReceipt(options.out, receipt);
    const output = options.json
      ? `${JSON.stringify(receipt)}\n`
      : humanOutput(receipt, options.out);
    return { exitCode: receipt.qualified ? 0 : 1, output, receipt };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      exitCode: 2,
      output: wantsJson
        ? `${JSON.stringify({ error: message })}\n`
        : `Agent-task qualification failed: ${message}\n`,
      receipt: null,
    };
  }
}

function parseArgs(args) {
  const options = { root: undefined, taskId: undefined, out: undefined, json: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--json') {
      options.json = true;
      continue;
    }
    if (['--root', '--task', '--out'].includes(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
      index += 1;
      if (argument === '--root') options.root = value;
      if (argument === '--task') options.taskId = value;
      if (argument === '--out') options.out = value;
      continue;
    }
    throw new Error(`unknown argument: ${argument}`);
  }
  if (!options.taskId) throw new Error('--task is required');
  return options;
}

function humanOutput(receipt, outputPath) {
  const lines = [
    `Task: ${receipt.task_id}`,
    `Qualified: ${receipt.qualified ? 'yes' : 'no'}`,
    `Baseline: ${receipt.baseline.status} (${receipt.baseline.attempts.length} attempts)`,
    `Known good: ${receipt.known_good.status} (${receipt.known_good.attempts.length} attempts)`,
    `Cleanup: ${receipt.cleanup.status}`,
  ];
  if (outputPath) lines.push(`Receipt: ${outputPath}`);
  return `${lines.join('\n')}\n`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  let result;
  try {
    result = await runQualificationCli();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result = { exitCode: 2, output: `Agent-task qualification failed: ${message}\n` };
  }
  process.stdout.write(result.output);
  process.exitCode = result.exitCode;
}
