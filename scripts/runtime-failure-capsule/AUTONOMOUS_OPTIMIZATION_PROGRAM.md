# Autonomous optimization agent program

Use this program only inside a local, disposable, independently runnable
checkout. CodeVetter owns evidence and decisions; the coding agent owns source
inspection, one hypothesis, and one bounded edit.

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
