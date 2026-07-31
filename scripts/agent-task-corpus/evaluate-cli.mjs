#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

import { evaluateReceiptBundle, writeEvaluationScore } from './evaluate-receipts.mjs';

export async function runEvaluationCli(args = process.argv.slice(2)) {
  const wantsJson = args.includes('--json');
  try {
    const options = parseArgs(args);
    const result = await evaluateReceiptBundle({
      bundlePath: options.bundlePath,
      root: options.root,
    });
    if (options.out) await writeEvaluationScore(options.out, result.score);
    return {
      ...result,
      exitCode: 0,
      output: wantsJson
        ? `${JSON.stringify(result.score)}\n`
        : humanOutput(result.score, options.out),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      exitCode: 2,
      output: wantsJson
        ? `${JSON.stringify({ error: message })}\n`
        : `Agent-task evaluation failed: ${message}\n`,
      manifest: null,
      score: null,
    };
  }
}

function parseArgs(args) {
  const options = { bundlePath: undefined, root: undefined, out: undefined };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--json') continue;
    if (['--bundle', '--root', '--out'].includes(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
      index += 1;
      if (argument === '--bundle') options.bundlePath = value;
      if (argument === '--root') options.root = value;
      if (argument === '--out') options.out = value;
      continue;
    }
    throw new Error(`unknown argument: ${argument}`);
  }
  if (!options.bundlePath) throw new Error('--bundle is required');
  return options;
}

function humanOutput(score, outputPath) {
  const lines = [
    `Score: ${score.score_id}`,
    `Qualification: ${score.scorecard.qualification.state}`,
    `A/B pairs: ${score.scorecard.ab.complete_pairs}`,
    `A/A pairs: ${score.scorecard.aa.complete_pairs}`,
    `Scorer: ${score.scorer.version} (${score.scorer.sha256})`,
    `Ground truth: ${score.evidence.ground_truth_sha256}`,
  ];
  if (outputPath) lines.push(`Derived score: ${outputPath}`);
  return `${lines.join('\n')}\n`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runEvaluationCli();
  process.stdout.write(result.output);
  process.exitCode = result.exitCode;
}
