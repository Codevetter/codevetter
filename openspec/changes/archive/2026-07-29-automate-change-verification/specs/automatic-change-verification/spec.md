## ADDED Requirements

### Requirement: T-Rex starts from one change and one preview
For an already selected repository, T-Rex SHALL accept either a canonical
GitHub PR URL or one local Git range plus one HTTP(S) preview URL as the complete
normal-path input. It SHALL NOT require watcher registration, route, goal,
loop, runner, test command, or model selection.

#### Scenario: The operator supplies a PR and preview
- **WHEN** the PR belongs to the selected repository and the preview URL is allowed
- **THEN** T-Rex resolves and tests the target without another setup interaction

#### Scenario: The operator supplies a commit range and preview
- **WHEN** both range endpoints resolve in the selected repository
- **THEN** T-Rex tests the exact range against the supplied preview without checking out another branch

### Requirement: Source resolution is exact, bounded, and read-only
PR mode SHALL resolve repository identity, PR number, base SHA, head SHA, and
bounded changed paths through read-only GitHub calls. Range mode SHALL accept
only one bounded `base..head` or `base...head` expression and resolve exact
endpoint SHAs, ordered commits, and bounded changed paths through shell-free Git
commands. Resolution MUST NOT mutate the checkout. Invalid, mismatched,
truncated, option-like, or drifting inputs SHALL return `no_confidence`.

#### Scenario: The PR belongs to another repository
- **WHEN** the PR owner or repository does not match the selected repository origin
- **THEN** T-Rex refuses execution and identifies the repository mismatch

#### Scenario: The change exceeds a bound
- **WHEN** changed paths or command output exceed the declared limit
- **THEN** T-Rex returns `no_confidence` rather than testing a silent subset

### Requirement: Preview identity remains explicit
T-Rex SHALL accept only HTTP(S) preview URLs without embedded credentials and
SHALL inspect explicit revision headers after bounded redirects. It SHALL
classify preview identity as `verified` when an explicit revision exactly
matches the resolved head, `mismatch` when it conflicts, and `claimed` when no
explicit revision is available. Page copy, URL shape, and model output MUST NOT
prove preview identity.

#### Scenario: The preview exposes the matching head
- **WHEN** a supported revision header equals the resolved head SHA
- **THEN** the receipt records `verified` and the exact header evidence

#### Scenario: The preview exposes another revision
- **WHEN** a supported revision header conflicts with the resolved head SHA
- **THEN** T-Rex records `mismatch`, does not claim the change passed, and returns `no_confidence`

#### Scenario: The preview exposes no revision
- **WHEN** no supported revision header is present
- **THEN** T-Rex records `claimed` and preserves the missing linkage as a limitation

### Requirement: Changed paths select bounded preview journeys
T-Rex SHALL always select the root smoke journey and SHALL derive additional
routes only from supported `pages`, `app/**/page`, and `routes` conventions.
The plan SHALL be deterministic, deduplicated, and capped. Dynamic, ambiguous,
or unmapped executable paths SHALL be recorded as limitations rather than
guessed.

#### Scenario: A conventional page changes
- **WHEN** the changed path maps unambiguously to a static route
- **THEN** T-Rex selects that route and records the changed-path reason

#### Scenario: A dynamic page changes
- **WHEN** the route contains a parameter whose value cannot be derived safely
- **THEN** T-Rex omits the guessed route and records the dynamic coverage limitation

### Requirement: Preview execution is remote-safe and model-free
Each planned route SHALL execute through the shared `generic-page-smoke`
contract using a bounded browser adapter. Browser-agent release builds SHALL
use the native Chrome adapter, while supported unpackaged development builds
MAY reuse the Playwright adapter. Execution SHALL require no authentication
and SHALL retain bounded artifacts. The first slice SHALL navigate and observe
only; it MUST NOT click controls, submit forms, upload files, send messages,
purchase, delete, or mutate durable state. A model MUST NOT select actions or
produce the verdict.

#### Scenario: A route renders with an unexpected console failure
- **WHEN** the runner reaches the route but captures a qualified console error
- **THEN** the journey fails and preserves its diagnostic and failure artifact

#### Scenario: A route cannot load
- **WHEN** navigation, visible content, or browser execution cannot complete
- **THEN** the journey fails or returns no confidence with the operational evidence

### Requirement: One receipt preserves verdict and limitations
T-Rex SHALL emit and persist one versioned receipt containing source target,
base/head identities, commits when available, bounded changed paths, preview
URL and identity evidence, route plan, journey results, artifacts, timing,
limitations, and one deterministic verdict.

- `failed` SHALL mean at least one required journey produced executable failure
  evidence.
- `no_confidence` SHALL mean source, preview, execution, bounds, persistence, or
  cleanup was invalid or incomplete, including preview mismatch.
- `passed_with_limits` SHALL mean every selected journey passed while bounded
  coverage and any claimed preview identity remain explicit.

#### Scenario: All journeys pass against a claimed preview
- **WHEN** the preview exposes no revision and every selected journey passes
- **THEN** the receipt reports `passed_with_limits` and states that PR-to-preview linkage was not proven

#### Scenario: One journey fails
- **WHEN** any required route journey fails
- **THEN** the receipt reports `failed` and retains both failed and successful journey evidence

### Requirement: Existing T-Rex workflows remain compatible
The direct-run workflow SHALL be additive. Existing watcher, warm verification,
differential verification, scenario compiler, Synthetic QA, and recent watcher
history contracts MUST remain available and unchanged.

#### Scenario: The direct-run panel is idle
- **WHEN** the operator uses an existing expert T-Rex workflow
- **THEN** no direct-run configuration or receipt is required

### Requirement: CLI and Tauri share one verification service
CodeVetter SHALL expose the change-plus-preview workflow through
`codevetter trex`. The CLI SHALL accept exactly one of `--pr` or `--range`, one
`--preview`, and an optional `--repo` defaulting to the current directory. It
SHALL call the same source resolution, route planning, preview identity,
journey, aggregation, persistence, and receipt contracts as Tauri.

#### Scenario: A terminal run uses the current repository
- **WHEN** the operator runs `codevetter trex --range main..HEAD --preview <url>` from a Git repository
- **THEN** the CLI verifies that repository without requiring the desktop UI to be open

#### Scenario: The operator requests machine output
- **WHEN** the operator supplies `--json`
- **THEN** stdout contains one canonical T-Rex receipt and no decorative text

#### Scenario: The source selector is ambiguous
- **WHEN** both or neither of `--pr` and `--range` are supplied
- **THEN** the CLI rejects the invocation before source or browser execution

### Requirement: CLI exit status preserves verdict meaning
The CLI SHALL exit `0` only for `passed_with_limits`, `1` for an executable
`failed` verdict, and `2` for `no_confidence`, invalid input, or operational
failure. Human-readable output SHALL include verdict, exact head, preview
identity, journey counts, and limitations.

#### Scenario: A browser journey fails
- **WHEN** the shared receipt verdict is `failed`
- **THEN** the CLI prints the failure evidence and exits `1`

#### Scenario: Preview identity mismatches
- **WHEN** the shared receipt verdict is `no_confidence`
- **THEN** the CLI preserves the mismatch evidence and exits `2`

### Requirement: Installed app safely registers its bundled CLI
The macOS app SHALL bundle the `codevetter` executable and, on installed-app
launch, SHALL ensure a user-scoped `~/.local/bin/codevetter` launcher targets
the bundled executable. Registration MUST be atomic, MUST NOT occur from a
development/unpackaged launch, and MUST NOT overwrite an unrelated file or
symlink. CodeVetter MUST NOT edit shell profiles or require administrator
access.

#### Scenario: The app launches after installation
- **WHEN** the bundled CLI exists and no launcher collision exists
- **THEN** CodeVetter creates the user-scoped launcher without another setup interaction

#### Scenario: Another command owns the path
- **WHEN** `~/.local/bin/codevetter` is a regular file or unrelated symlink
- **THEN** CodeVetter leaves it untouched and records the collision

#### Scenario: The app is running from a development target
- **WHEN** the executable is not inside an installed `.app/Contents/MacOS`
- **THEN** automatic CLI registration is skipped
