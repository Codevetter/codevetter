# Autonomous optimization agent program

Use this program only inside a local, disposable, independently runnable
checkout. CodeVetter owns evidence and decisions; the coding agent owns source
inspection, one hypothesis, and one bounded edit.

For a qualified browser flow, prefer the high-level loop so CodeVetter gathers
all supported evidence families before the first edit:

1. Capture the exact Playwright flow and initialize its optimization campaign.
2. Call `plan_browser_optimization_loop` with the capture ID and campaign
   directory. Preserve the returned loop ID. For build-graph experiments, also
   provide the contained build directory and source/artifact SHA-256 attestation
   produced by a separately trusted builder. The plan automatically consults
   CodeVetter's review-evidence selector and attaches any exact source-owned
   correctness scope or current accepted local evidence to matching work.
3. Call `get_next_browser_experiment`. If `state` is not `active`, report the
   coverage-qualified terminal result and stop.
4. Inspect only the cited evidence and source boundary. Apply one candidate
   edit using normal host tools; do not alter evaluators, evidence, dependencies,
   generated files, or anything outside `allowed_files`.
5. Call `evaluate_browser_experiment`. CodeVetter checks the edit boundary,
   runs correctness-first screening, promotes only promising candidates with an
   independently runnable incumbent checkout, and replans after a confirmed
   keep. Supply the candidate build attestation again when the predicted metric
   is initial-route JavaScript.
6. After rejection, restore the exact incumbent using the host's recoverable
   worktree or branch operation. CodeVetter will not serve the next experiment
   until the source snapshot matches.
7. Repeat steps 3–6 until the queue, plateau, time, experiment, or failure budget
   stops the loop.

The repository CLI exposes the same protocol as
`runtime:plan-browser-optimization-loop`,
`runtime:get-next-browser-experiment`, and
`runtime:evaluate-browser-experiment`. Neither surface accepts a patch or shell
command.

CodeVetter deliberately does not run a repository Vite build to create the
attestation. Vite configuration is arbitrary code and may load environment
files. An unattested `dist` directory can rank an experiment but cannot retain
it.

Use the lower-level campaign program below for non-browser flows or protocol
debugging.

1. Read the repository instructions and campaign `manifest.json`. Do not alter
   the manifest, evaluator targets, campaign ledger, evidence, dependencies,
   generated files, or files outside `allowed_files`.
2. Call `get_optimization_campaign_status`. Stop when it reports `stopped` or
   has no `next_action`.
3. If the next action is `capture_baseline`, call
   `capture_optimization_baseline`. Do not edit source first.
4. If the next action is `propose_candidate`, inspect the incumbent evidence and
   relevant source. State one falsifiable hypothesis, edit only allowed source,
   and call `screen_optimization_candidate` with that exact hypothesis.
5. Treat `discard`, `crash`, and `no_confidence` as negative evidence. Restore
   the independently saved incumbent source using a recoverable branch or
   worktree operation supplied by the host; never use destructive reset.
6. Treat `promising` only as permission to run paired promotion. Start the MCP
   server with `--incumbent-repo` pointing to an independently runnable checkout
   whose source identity matches the recorded incumbent, then call
   `promote_optimization_candidate` with the same hypothesis.
7. Preserve a candidate only when promotion returns `keep`. Record what the
   benchmark covers, what it does not cover, elapsed local compute, and any
   limitations. A synthetic speedup is not a product-wide claim.
8. Repeat from status until a deterministic budget or plateau stops the
   campaign. Never call production endpoints, cloud runners, paid models,
   dependency installers, migration tools, commit, push, or deploy from this
   loop unless the operator separately authorizes them.

The agent may inspect and edit source with its normal host tools. The CodeVetter
MCP deliberately accepts no shell command, patch, model, or arbitrary benchmark
configuration after initialization.
