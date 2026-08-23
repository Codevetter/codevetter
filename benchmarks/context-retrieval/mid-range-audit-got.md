# Mid-range audit — `got`

Audited 2026-08-23 from the 44 deterministic nominations stored in the committed
single-project artifacts. This is a **bounded audit**, not a full clearance of the
published recall@10 results.

## Result

- 44/44 nominations joined to the intended corpus case and provider score row.
- 44/44 stored top-five recall values reproduced with an independent set-based
  calculation that does not import the scorer's measurement helper.
- 44/44 required-file sets were present in the actual Git diff between the case's
  pinned base and target revisions.
- Every returned path in all 44 stored samples existed at the indexed base revision.
- Reading the sampled path/query pairs found no cross-repository paths, temporary
  worktree paths, malformed path shapes, or other obvious adapter-output anomaly.

No published table changes as a result of this audit.

## Limitation found by the audit

The legacy nomination record is malformed in two linked ways: it reads
`case.changed_files`, while the corpus contract calls the field `required_files`, and
it stores only five returned paths even though partial recall@10 is what nominates a
case. Consequently, every artifact omitted its expected answer and **0/44 nominations
preserved enough ranked output to independently reproduce recall@10**.

The audit command recovers the expected set and case identity from the committed
corpus, then verifies only the top-five metric that the legacy bytes can prove. Ranks
6–10 cannot be reconstructed. A complete audit of the already-published recall@10
sample therefore still requires fresh provider runs; it must not be inferred from this
top-five pass.

Future score artifacts bind `case_id`, `required_files`, ten returned paths, the
window size, and claimed recall@10. The nomination count is also bounded per provider
rather than by a cross-provider global total.

## Reproduce

Use a checkout of `got` whose object database contains the corpus history:

```bash
node scripts/context-retrieval/audit-nominations.mjs \
  --corpus benchmarks/context-retrieval/corpora/corpus-got.json \
  --score-dir benchmarks/context-retrieval/results/full-field-got \
  --repo /path/to/got
```

The command exits non-zero if a stored-window metric differs, a nomination cannot be
joined, a required file is absent from the historical change, or a returned path is
absent at the indexed revision. Omitting `--repo` performs only the artifact/corpus
checks and reports Git checks as not run.
