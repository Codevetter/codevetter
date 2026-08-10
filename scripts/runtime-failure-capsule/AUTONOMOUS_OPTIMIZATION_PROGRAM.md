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
   whose source identity matches the recorded incumbent. Have the operator
   create the candidate commit before promotion; the campaign itself has no
   commit authority. Then call
   `promote_optimization_candidate` with the same hypothesis.
7. Preserve a candidate only when promotion returns `keep`. Record what the
   benchmark covers, what it does not cover, elapsed local compute, and any
   limitations. A synthetic speedup is not a product-wide claim.
8. Before publication, call `challenge_optimization_candidate` for the exact
   clean `keep` SHA. Supply either one directly comparable qualified candidate or a
   bounded reason that a simpler comparison is not applicable. A speedup does
   not compensate for unqualified patch complexity. Where promotion evidence
   contains smaller-input or secondary metrics, the selected candidate must
   remain inside tolerance on those controls as well as the target.
9. After the candidate has an exact commit and pull request, call
   `inspect_optimization_contribution`. Keep optional T-Rex browser-flow
   evidence independent and SHA-matched. Treat current review threads, stale
   heads, failing or approval-required checks, and missing required T-Rex
   evidence as separate blockers.
10. Refresh contribution evidence only when the operator asks. Do not poll,
   comment, request review, resolve feedback, approve workflows, merge, deploy,
   or ask maintainers to inspect CodeVetter's raw local receipts. A revised
   current receipt may preserve prior actionable feedback as revision-bound
   learning and regenerate the concise local publication projection; head drift
   only marks an existing projection stale.
11. Repeat from status until a deterministic budget or plateau stops the
   campaign. Never call production endpoints, cloud runners, paid models,
   dependency installers, migration tools, commit, push, or deploy from this
   loop unless the operator separately authorizes them.

The agent may inspect and edit source with its normal host tools. The CodeVetter
MCP deliberately accepts no shell command, patch, model, or arbitrary benchmark
configuration after initialization.
