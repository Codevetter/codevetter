#!/usr/bin/env node
import { resolve } from 'node:path';
import {
  createPlan,
  createReceipt,
  executeLane,
  loadConfig,
  resolveGitChange,
  schedulePlan,
} from './core.mjs';

const args = new Set(process.argv.slice(2));
const valueAfter = (flag) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const root = resolve(valueAfter('--repo') ?? '.');
const config = await loadConfig();
const exhaustive = args.has('--exhaustive');
const profileName = exhaustive ? 'exhaustive' : (valueAfter('--profile') ?? 'interactive');
const change = resolveGitChange(root, {
  staged: args.has('--staged'),
  commit: valueAfter('--commit'),
  range: valueAfter('--range'),
});
const plan = createPlan({ config, change, profile: profileName, exhaustive });
let lanes = plan.lanes.map((lane) => ({
  id: lane.id,
  status: 'not_run',
  wallMs: 0,
  queueMs: 0,
  cpuMs: 0,
  peakRssBytes: 0,
  output: '',
}));
let mode = 'planned';
if (args.has('--execute')) {
  mode = 'executed';
  lanes = await schedulePlan(plan, config.profiles[plan.profile], (lane, context) =>
    executeLane(lane, { ...context, cwd: root })
  );
}
const receipt = createReceipt(plan, lanes, mode);
process.stdout.write(`${JSON.stringify({ plan, receipt }, null, args.has('--json') ? 0 : 2)}\n`);
if (receipt.verdict === 'failed') process.exitCode = 1;
if (receipt.verdict === 'no_confidence' || receipt.verdict === 'cancelled') process.exitCode = 2;
