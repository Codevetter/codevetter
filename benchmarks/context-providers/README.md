# Context-provider experiment

This directory holds the reproducible comparison of plain repository tools and
optional code-context providers. It composes with the existing 30-task agent
corpus and executable graders; it does not create a second outcome authority.

## Stage 0 status

Stage 0 is planning-only. It records closed capability probes and an immutable
feasibility plan without starting a provider, building an index, launching an
agent, reading credential values, or incurring provider cost.

The pinned Stage 0 plan compares:

- `plain-repository-tools`, the required control with no provider tools; and
- `codevetter-structural-context` 1.7.0, the local graph treatment exposing the
  product's `graph_query` through a bounded experiment-only CLI.

The deterministic slice has four qualified tasks: two API and two browser
tasks across four categories. Two repetitions and two arms produce exactly 16
attempts with balanced first-position ordering.

The provider cohort is local, has no data egress, requires no credential names,
and has a $0 context-provider bound. Stage 0 remains deliberately unselected
and blocked; it is not execution approval.

Artifacts:

- [`stage0/feasibility-plan.json`](stage0/feasibility-plan.json)
- [`stage0/probes/plain-repository-tools.json`](stage0/probes/plain-repository-tools.json)
- [`stage0/probes/codevetter-structural-context.json`](stage0/probes/codevetter-structural-context.json)

The 2026-08-15 external capability probe admitted no additional provider to
this free/local cohort:

| Provider | Result | Blocking evidence |
| --- | --- | --- |
| CodeGraph | Excluded | No installed version or demonstrated immutable revision-bound snapshot |
| Graphify | Blocked | Local CLI/package identity drift and no immutable snapshot identity |
| RepoWise | Excluded | Hosted source egress, account setup, and no reproducible local snapshot |
| DeepWiki | Excluded | Hosted public-wiki interface cannot index fresh isolated task workspaces |
| Sourcegraph | Excluded | Enterprise/authenticated cohort with no approved instance or immutable snapshot |

These are eligibility results, not product-quality rankings. The bounded probe
artifacts preserve source URLs, local command evidence, and limitations. No
account was created, credential read, source uploaded, package installed, or
provider/index process launched.

## Stage 1 result — 2026-08-16

The owner approved the exact candidate identity and all 16 scheduled attempts
completed locally:

- Candidate plan: `plan-fd924b482cd13928579a84eebacf36b2`
- Required approval: `approval-0bd3cf8c18706ffd739bcff4d8aa4acf`
- Attempts: 16 across four tasks, two repetitions, and two balanced arms
- Agent: cached local Qwen3 4B MLX snapshot, temperature 0, fixed seed,
  `HF_HUB_OFFLINE=1`, and `TRANSFORMERS_OFFLINE=1`
- Cost bound: $0 for the provider and agent; no hosted service or data egress
- Duration bound: under 35 minutes from the 120-second adapter timeout plus
  five-second hidden-check timeout per attempt
- Evidence: four source-hash-bound CodeVetter snapshots, stored only in the
  ignored local evidence directory; the candidate plan publishes identities,
  revisions, and fixture hashes rather than source-derived graph payloads

- Eight of eight A/B pairs were complete, with four distinct tasks, no missing
  arms, no rejected pairs, and complete cleanup for all 16 attempts.
- The control succeeded twice; the treatment did not succeed. The result was
  two control wins, zero treatment wins, six failure ties, and a descriptive
  success-rate delta of -25 percentage points (`p = 0.5`).
- Treatment recorded six `graph_query` calls and baseline recorded none.
  Recorded input tokens were 7,858 for treatment and 3,440 for control, but the
  two treatment agent failures emitted no diagnostics, so this is an incomplete
  cost comparison rather than a token-overhead estimate.
- Terminal evidence comprised two successes, four check failures, eight check
  errors, and two treatment-only agent failures. The two agent failures retain
  identical bounded stderr hashes and byte counts, but not diagnostic text, so
  their exact cause cannot be recovered from the receipt.

Decision: **revise the probe/adapter and failure evidence before requesting
Stage 2**. CodeVetter context did not demonstrate value for this local 4B agent,
and the treatment regressed the only task the control solved. The run also
exposed and fixed an evaluator boundary bug: a valid verifier `check_error`
with no returned check records is now projected as explicit skipped checks.
The immutable run receipts were not modified.

The score is deliberately `unqualified`. Stage 1 has no independent A/A noise
arm, the observed effect is negative, and feasibility evidence cannot establish
a provider winner. Stage 2 still requires a separate exact approval.

Private ignored evidence root:
`.codevetter/verify-artifacts/context-provider/runs/plan-fd924b482cd13928579a84eebacf36b2/`

| Artifact | SHA-256 |
| --- | --- |
| `attempts.json` | `9cee1f25b896cfd35940337880687867926b30898532274dc2d57ac470fbd36c` |
| `evaluation-bundle.json` | `eb4a381644f4b4e5ca06a57748773d747bb85b70f0b2ef9bdf34de9608e78bcf` |
| `evaluation-score.json` | `d8a546d67f1b9c1fede5238f8ad82bb52a2cd4133fbac9ffccf9cf0d2c0c7aa6` |
| `comparison.json` | `3ecfa05695526ce218a85025b3b21e389d62839fdb25fdd212723e5464af8f26` |
| `comparison.md` | `d0bfa21d479caf196e0aac48433509f6effd463c7f82cc3e10eb8d549eb579d8` |
| `comparison.html` | `46ce225f2c44f4b3adee4bfd0e1fbfec2b40d7f45222e5bbea50ecffaeeacd5d` |

The final offline adapter preflight completed the baseline in 3.4 seconds; an
earlier treatment preflight completed in 3.3 seconds with all hidden checks
passing. Preflights are not Stage 1 evidence. The runner enforces loopback model
transport; explicit MLX/Hugging Face offline flags prevent the known metadata
lookup but are not an operating-system network sandbox.

Regenerate the plan from the repository root:

```bash
pnpm corpus:context-plan \
  --stage feasibility \
  --probe benchmarks/context-providers/stage0/probes/plain-repository-tools.json \
  --probe benchmarks/context-providers/stage0/probes/codevetter-structural-context.json
```

The output must remain descriptive until later runs satisfy the preregistered
hidden-check, completeness, isolation, and statistical qualification gates in
the OpenSpec change `compare-code-context-providers`.

After the owner explicitly approves the candidate identity, start the pinned
local MLX server with both offline environment flags, then execute it with:

```bash
HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 \
uvx --offline --from mlx-lm --with huggingface-hub mlx_lm.server \
  --model <cached-qwen-snapshot-path>/50d427756c6b1b2fe0c0a10f67fbda1fc8e82c1b \
  --host 127.0.0.1 --port 18081 --temp 0 --max-tokens 1200

pnpm corpus:context-run \
  --plan benchmarks/context-providers/stage1/candidate-plan.json \
  --approve approval-0bd3cf8c18706ffd739bcff4d8aa4acf \
  --model-url http://127.0.0.1:18081 \
  --tool apps/desktop/src-tauri/target/debug/examples/context_provider_fixture
```

After an approved run produces one closed attempt record per schedule arm,
project and score each pair through the existing evaluator, then aggregate it:

```bash
pnpm corpus:context-evaluate project \
  --plan benchmarks/context-providers/stage1/candidate-plan.json \
  --provider codevetter-structural-context \
  --attempts path/to/attempts.json \
  --out path/to/evaluation-bundle.json

pnpm corpus:evaluate --bundle path/to/evaluation-bundle.json \
  --out path/to/evaluation-score.json

pnpm corpus:context-evaluate aggregate \
  --plan path/to/approved-plan.json \
  --pairwise codevetter-structural-context,path/to/evaluation-score.json,path/to/evaluation-bundle.json \
  --format markdown \
  --out path/to/comparison.md
```
