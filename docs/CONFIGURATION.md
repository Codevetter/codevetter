# Configuration

CodeVetter's active product is the local Tauri desktop app. It does not require
a server-side environment file for normal use. Provider credentials and product
preferences are entered in Settings and stored locally; SQLite stores product
records. Never commit credentials, browser storage state, or local auth files.

## Desktop runtime

### Review providers

Settings stores the selected provider base URL, API key, model, review tone,
custom rules, and standards packs under the local browser key
`codevetter_review_config`. A missing or incomplete provider config disables
provider-backed review but does not affect deterministic warm verification.

Supported presets are Anthropic, OpenAI, OpenRouter, and the optional fleet
`free-ai` gateway. API keys remain user-supplied local settings.

### Vite and Tauri

`apps/desktop/vite.config.ts` serves the webview at `http://localhost:1420` and
writes production frontend output to `apps/desktop/out/`.

`apps/desktop/src-tauri/tauri.conf.json` defines:

- bundle identifier `com.codevetter.desktop`;
- development URL `http://localhost:1420`;
- frontend output `../out`;
- the desktop content-security policy;
- updater metadata and the `codevetter-mcp` external sidecar.

Do not change updater endpoints, signing, production CSP, or release metadata as
part of local verification setup.

### Optional integrations

`CODEVETTER_LINEAR_CLIENT_ID` enables the optional Linear integration when
provided to the desktop process. Its absence leaves that integration unavailable
and does not prevent startup.

## Warm verification target file

Warm verification is opt-in for a trusted repository through the strict
schema-v1 file `.codevetter/verify.yaml`:

```yaml
version: 1
target:
  command: [pnpm, dev]
  cwd: .
  readinessUrl: http://127.0.0.1:1420/
  baseUrl: http://127.0.0.1:1420
  allowedEnv: [NODE_ENV]
  hmrSettleMs: 250
  shutdownGraceMs: 3000
scenarioModules: [verify/scenarios.mjs]
authProfiles:
  developer:
    storageState: .codevetter/auth/developer.json
capabilities:
  - id: review
    paths: [src/pages/QuickReview.tsx, src/components/quick-review/**]
    scenarios: [review-smoke]
mandatorySmoke: [shell-smoke]
sharedInfrastructure:
  paths: [package.json, src/main.tsx]
  fallbackScenarios: [shell-smoke, review-smoke]
network:
  firstPartyOrigins: [http://127.0.0.1:1420]
  allowedFirstPartyRequests: [GET /**]
  blockThirdParty: true
  allowedThirdPartyOrigins: []
retention:
  directory: .codevetter/artifacts
  maxRuns: 20
  maxBytes: 104857600
  maxAgeDays: 14
budgets:
  parallelism: 4
  actionMs: 3000
  scenarioMs: 15000
  batchMs: 30000
  slowInteractionMs: 1000
```

### Target rules

- `target.command` is an argv array; no shell string is evaluated.
- `target.cwd`, scenario modules, auth profiles, and retention paths must remain
  inside the canonical repository.
- Readiness and base URLs must be loopback URLs.
- `target.allowedEnv` lists environment names only. Values are read at runtime
  and are never copied into persisted evidence.
- `scenarioModules` must export deterministic scenario manifests.
- `capabilities[].paths` is authoritative changed-file selection.
- `mandatorySmoke` always runs; `sharedInfrastructure.fallbackScenarios` covers
  broad or unmatched changes.
- Parallelism is bounded from one through four. Action, scenario, batch, and
  slow-interaction budgets are mandatory.
- Unknown keys, duplicate IDs, invalid globs, unknown scenarios, unsupported
  schema versions, or unsafe paths produce `no_confidence`; they are never
  ignored silently.

Store authentication state under a gitignored path such as
`.codevetter/auth/developer.json`. The verifier copies it into a fresh context
for each scenario. It must never be included in evidence or artifacts.

## Repository-owned CLI discovery

The Tauri bridge requires:

1. exactly one non-empty `verify` package script in the root package or a
   bounded `apps/*`-style workspace;
2. exactly one supported repository lockfile: `pnpm-lock.yaml`,
   `package-lock.json`, `yarn.lock`, `bun.lock`, or `bun.lockb`;
3. the package and manifest to resolve inside the canonical repository.

The lockfile selects the package manager. The bridge invokes the script through
direct arguments, passes a small allowlist of process environment variables,
caps output and execution time, and validates JSON before persistence. It does
not bundle Node, a package manager, Playwright, or Chromium.

## Runtime and retained data

`verifyd` uses a private, current-user-owned Unix socket under
`/tmp/cv-verify-<uid>/`. The directory and socket permissions are restricted,
and the repository identity is derived from the canonical repository path.

The configured retention directory contains owner-marked `run-summary.json`
files and optional redacted artifacts:

- passing runs keep summaries unless detailed capture is requested;
- regression and `no_confidence` runs may keep bounded supporting artifacts;
- cleanup applies run-count, byte, and age caps oldest-first;
- cleanup never follows symlinks or removes unowned data;
- the shared Playwright browser cache is measured only and is never deleted by
  CodeVetter.

## Outcome and evidence policy

Warm results include exact change-set, config, manifest, verifier-source, and
target identities. Review qualifies executable evidence only when the newest
stored result matches the independently collected current identity. Missing,
stale, cancelled, incomplete, legacy-only, or operational evidence cannot pass.

The implemented scope is one developer, one configured React app, one Mac, and
one Chromium. CI, cloud execution, teams, mobile, cross-browser support, and
arbitrary repository orchestration remain outside this configuration contract.
