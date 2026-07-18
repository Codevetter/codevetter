# Show HN — CodeVetter launch

Draft assets for the Show HN post. Keep the voice plain and technical — no
marketing adjectives, no "revolutionary," no emoji. HN rewards specificity and
honest limitations.

## Title options

Pick one. Ranked by how well they signal what the thing actually is.

1. **Show HN: CodeVetter — a desktop code reviewer for agent-generated code, with a public benchmark**
2. **Show HN: I built an offline AI code review tool and a 27-case benchmark to score it**
3. **Show HN: CodeVetter — vet AI diffs before merge (Tauri, runs locally, 27-case public benchmark)**
4. **Show HN: A hand-labeled benchmark for AI code review (27 cases, 29 findings, scorer included)**
5. **Show HN: CodeVetter — catch what your coding agent missed, offline**

Option 1 leads with the product and the proof together. Option 4 leads with
the benchmark, which is the more defensible/interesting part for an HN crowd
skeptical of "AI review" claims. Recommend 1 or 4.

## First comment (author's top-level explanation)

Paste this as the first comment right after posting.

---

Hi — I'm the maker of CodeVetter.

The short version: it's a desktop app (Tauri, so a real native binary, not a
wrapper site) that reviews code diffs the way a second engineer would —
catches bugs, security issues, and regressions in changes an AI agent wrote
before you merge them. It runs locally; your repo doesn't get uploaded to a
server. You bring your own LLM key (Anthropic / OpenAI / OpenRouter).

The reason I'm posting it here is the benchmark. "Our AI catches bugs" is
unfalsifiable as a claim, so I built a public one and scored CodeVetter
against it.

The set: 27 hand-labeled code snippets, 29 expected findings, across
TypeScript, JavaScript, Python, Go, Rust, and Java. Each case is a single
self-contained file with a known issue (SQL injection, path traversal, race
condition, prototype pollution, zip bomb, integer overflow, etc.) and a
hand-written ground-truth label (type, severity, line range, description).

The scorer is one Node script (`npm run bench:public`). It computes catch
rate, precision, F1, false positives, and redundant matches. The dataset is
a single JSON file under CC0.

The numbers, scored honestly:

- CodeVetter: 29/29 findings caught (100% catch rate), precision 0.433, F1
  0.604, 29 false positives.
- Raw Claude baseline (same model, prompted once with "review this code," no
  harness): 27/29 (93.1%), precision 0.397, F1 0.557, 31 false positives.

The two findings raw Claude missed were a zip-bomb resource-exhaustion case
and one of two integer-overflow sites in a Rust case.

I want to be upfront about the limitations, because they're real:

- The cases are synthetic, single-file snippets — not diffs mined from real
  PRs. They test "does the reviewer recognize this issue in isolation," not
  "does it surface inside a 400-line PR with unrelated churn." There's a
  separate harness for the latter on real public agent PRs.
- 27 cases is small. It's enough to be reproducible and to separate 100%
  from 93%, but not enough to claim statistical significance between two
  reviewers near the top. Treat the gap as directional.
- Precision is the weak spot for both. CodeVetter emits 29 false positives
  across the set. A reviewer that shouted on every line would also hit 100%
  catch rate, which is why precision and F1 are reported next to it.
- Ground truth is one person's labels and could be wrong. If I missed a real
  issue that isn't labeled, catch rate is inflated. PRs adding or correcting
  labels are welcome.

Repo: https://github.com/Codevetter/codevetter
Benchmark page with the full per-case table: https://codevetter.com/benchmark
Dataset (CC0): https://codevetter.com/benchmark/codevetter-benchmark-v1.json

Happy to answer questions about the scoring method, the review pipeline, or
the Tauri/desktop architecture. Not interested in arguing that 100% on a
synthetic set means the product is good — it doesn't, and that's why the
limitations section is at the top of the page.

---

## Notes for posting

- Post Tuesday–Thursday, ~8–10am ET tends to do better; avoid Friday afternoon
  and weekends.
- The first comment should go up within 1–2 minutes of the post so the thread
  doesn't sit empty.
- If someone challenges the benchmark size or synthetic nature, agree first
  ("yes, it's small and synthetic — that's in the limitations section") then
  point at the real-PR harness. Do not get defensive.
- If someone asks "how is this different from Cursor/Copilot," the honest
  answer: those write code; this reviews diffs a human is about to merge. It's
  the second pair of eyes, not the author.
- Do not edit the title after posting. Do not ask friends to upvote.
