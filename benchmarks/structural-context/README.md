# Structural-context outcome evaluation

This benchmark answers one narrow question: when the same coding task and agent
configuration are paired, does access to CodeVetter's current structural graph
improve executable task outcomes?

It scores already-produced receipts. It does not launch agents, call model
providers, infer missing evidence, or replace the public catch-rate benchmark.

## Run the synthetic contract fixture

```bash
pnpm bench:graph-context
pnpm bench:graph-context -- --format=json
pnpm bench:graph-context -- --format=markdown
pnpm bench:graph-context -- --format=html --out=artifacts/structural-context.html
```

The committed sample is deliberately marked `synthetic`. It proves the scorer,
pairing, qualification, and report contracts only. Even when its descriptive
A/B numbers improve, the result remains unqualified for product-value claims.

## Receipt contract

Each manifest contains:

- `schema_version: 1`;
- an experiment identity, `synthetic` or `real` evidence kind, limitations, and
  qualification policy declared before scoring;
- immutable task identities: repository revision, task-packet SHA-256,
  acceptance-contract SHA-256, and required hidden checks;
- paired A/B run receipts with `control` and `treatment` arms;
- paired A/A receipts with `a` and `b` arms;
- exact agent, model, configuration, and environment identities per run;
- a structural-context policy and graph snapshot identity per run;
- executable check outcomes and regression counts;
- optional decision-efficiency diagnostics and graph decision traces.

Inputs are bounded to 5 MiB, 500 tasks, 5,000 runs, and 1,000 entries per
diagnostic list. Hashes are lowercase SHA-256 values. Missing required checks
remain an explicit `incomplete_checks` outcome; setup failures, agent failures,
timeouts, check failures, regressions, and successes are not collapsed.

## Isolation rules

An A/B pair is included only when both arms use the same task, trial, repository
revision, task packet, acceptance contract, agent, model, configuration, and
environment. The control must have structural context disabled, no graph
identity, and no graph-tool calls. The treatment must have structural context
enabled and a graph snapshot indexed at the exact task revision.

An A/A pair uses the same context policy, graph identity, and allowed graph-tool
set in both arms. It measures ordinary run-to-run discordance. Missing,
duplicate, mismatched, stale, or contaminated pairs are excluded and reported;
any invalid pair also fails qualification.

Hidden acceptance checks and regressions decide task success. File counts,
tool calls, token use, latency, cost, and verification selection are secondary
diagnostics only. Missing optional diagnostics are excluded from their paired
means rather than treated as zero.

## Real-trial workflow

1. Freeze a realistic TypeScript/Node task packet and its hidden acceptance
   contract at one repository revision.
2. Predeclare the qualification thresholds in the manifest.
3. Run both A/B arms with the same agent configuration and environment,
   alternating execution order across tasks and trials.
4. Give only the treatment arm CodeVetter graph tools and a snapshot of the
   frozen revision.
5. Run A/A repeats under one identical context policy to estimate noise.
6. Record provider-neutral receipts, including every required hidden check and
   regression count.
7. Score the manifest and inspect invalid-pair reasons before interpreting
   descriptive outcomes.
8. Treat a positive claim as qualified only when every predeclared gate passes.

The HTML report is a local, self-contained reading surface. It uses no external
assets, network requests, or required JavaScript, and adds no desktop route.
