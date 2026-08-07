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
const root = resolve('.');
const config = await loadConfig();
const exhaustive = args.has('--exhaustive');
const change = resolveGitChange(root);
const plan = createPlan({ config, change, exhaustive });
const lanes = args.has('--execute')
  ? await schedulePlan(plan, config.profiles[plan.profile], (lane, context) =>
      executeLane(lane, { ...context, cwd: root })
    )
  : plan.lanes.map((lane) => ({
      id: lane.id,
      status: 'not_run',
      wallMs: 0,
      queueMs: 0,
      cpuMs: 0,
      peakRssBytes: 0,
      output: '',
    }));
const receipt = createReceipt(plan, lanes, args.has('--execute') ? 'executed' : 'planned');
process.stdout.write(
  `${JSON.stringify(
    {
      schemaVersion: '1.0.0',
      capturedAt: new Date().toISOString(),
      machine: {
        platform: process.platform,
        arch: process.arch,
        logicalCpus: (await import('node:os')).cpus().length,
      },
      cacheState: args.has('--cold') ? 'cold' : 'warm-or-unknown',
      plan,
      receipt,
    },
    null,
    2
  )}\n`
);
