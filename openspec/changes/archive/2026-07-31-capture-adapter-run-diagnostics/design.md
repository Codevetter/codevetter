## Context

The provider-neutral runner already binds immutable adapter artifacts, creates
a public-input-only workspace, captures bounded redacted process output, waits
for terminal process state, executes withheld checks, and emits a closed v2
receipt. Adapter descriptors already expose optional `diagnostics_path`, but
that field is currently inert.

## Goals / Non-Goals

**Goals:**

- Make declared provider diagnostics usable without weakening receipt closure.
- Keep diagnostics optional and omit unavailable fields instead of inventing
  values.
- Bound path resolution, bytes, fields, counts, strings, and file paths.
- Prevent clean success when declared diagnostics cannot be trusted.
- Preserve diagnostics for failed adapter exits when a valid file exists.

**Non-Goals:**

- Shipping a Codex, Claude, OpenAI, or Anthropic adapter.
- Reading provider credentials or environment files.
- Trusting diagnostics as task correctness evidence.
- Adding timing, trace, prompt, response, or secret-bearing payload capture.

## Decisions

### Use a separate closed diagnostics document

The adapter writes `codevetter.agent-task-diagnostics.v1` at its declared
workspace-relative path. The document contains only optional bounded token,
cost, tool-name, inspected-file, and modified-file fields, and must contain at
least one observation beyond its schema version.

Alternative: parse arbitrary provider stdout. Rejected because provider output
formats drift and can contain prompts, responses, credentials, or unbounded
content.

### Resolve diagnostics inside the disposable workspace

`diagnostics_path` is an output path relative to the agent workspace. The
runner resolves it with the same safe regular-file and byte-limit boundary used
for corpus artifacts. Adapter-root artifacts remain immutable inputs and
cannot serve as per-run output.

Alternative: write to a host artifact directory. Rejected because it would
expand adapter write authority and cleanup scope.

### Load after termination and before hidden checks

The runner reads diagnostics only after a terminal adapter result. For a clean
zero exit, a declared missing or invalid document prevents hidden checks and
classifies the attempt as `agent_failure`. For a nonzero exit, valid
diagnostics may still be retained; invalid diagnostics do not replace the
already authoritative agent failure.

Alternative: load after checks. Rejected because a clean success receipt must
not be emitted when its declared evidence contract is broken.

### Redact and reject secret-shaped observations

Tool-call names use the existing bounded output redaction. Exact declared
environment values are forbidden anywhere in the diagnostics document, and
file lists must remain safe relative paths. The receipt never retains the
diagnostics path, temporary workspace path, prompts, responses, or raw
provider payload.

Alternative: store raw provider events. Rejected because they are unnecessary
for the current evaluator and materially increase secret and privacy risk.

## Risks / Trade-offs

- [Provider wrappers can self-report inaccurate metrics] → Treat diagnostics as
  activity metadata only; hidden executable checks remain authoritative.
- [Provider formats drift] → Keep provider parsing outside the runner in
  immutable adapters that emit one stable CodeVetter document.
- [A diagnostics contract failure can mask a passing patch] → Fail closed
  before checks when the adapter explicitly declared the evidence.
- [Tool names can contain sensitive arguments] → Bound and redact strings;
  document that adapters must emit tool identifiers, not raw commands.

## Migration Plan

Additive contract and optional adapter behavior. Existing adapters without
`diagnostics_path` retain byte-for-byte receipt behavior. Existing v1/v2
receipts remain readable.
