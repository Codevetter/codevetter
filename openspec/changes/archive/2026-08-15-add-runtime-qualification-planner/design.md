## Context

The existing detector scans manifests and runtime configuration, while the performance profiler requires the caller to supply an exact adapter, target, and optional test identity. The Fleet portfolio pass demonstrated the missing layer between those surfaces: runtime availability is common, but representative local workloads are not. See `proposal.md` and the runtime qualification specification for the observable contract.

The implementation must remain local, dependency-free, machine-readable, and conservative. Repositories may be dirty and must not be modified. A portfolio can contain unsupported stacks or missing dependency trees, and one bad entry must not hide the rest.

## Goals / Non-Goals

**Goals:**

- Turn bounded source evidence into explainable exact workload candidates.
- Make false positives visible through package scope, safety flags, status, and limitations.
- Give agents a safe profiling recipe only when the evidence is strong enough.
- Produce a complete portfolio matrix without executing target code.

**Non-Goals:**

- Proving that a discovered workload represents real user traffic.
- Automatically running every discovered candidate.
- Installing packages, starting databases, invoking browsers, or contacting hosted services.
- Replacing project-owned correctness or end-to-end verification.
- Encoding private Fleet paths or project identities in product code.

## Decisions

### 1. Add qualification beside detection instead of expanding lane claims

`detectRuntimeLanes` remains a low-cost capability detector. A new qualification module consumes its evidence and performs a bounded candidate scan. This preserves the meaning and compatibility of detection while giving higher-level callers a deliberately stricter contract.

Alternative considered: make detection return only profile-ready lanes. Rejected because a repository can support a runtime even when it has no representative benchmark, and failure diagnosis still benefits from knowing the lane exists.

### 2. Use explainable source heuristics, not model judgment

Candidate ranking uses fixed signals: benchmark declarations, performance/benchmark/scale naming, exact literal test names, package scope, and unsafe external-operation markers. Every score component is returned as evidence. The planner chooses `ready` only above a fixed threshold and otherwise asks for selection or a better workload.

Alternative considered: ask an LLM to select the best test. Rejected for the first slice because it introduces cost, nondeterminism, and unsupported semantic confidence. Model assistance can later consume these candidates without changing their evidence contract.

### 3. Exact identities are parsed conservatively

The bounded scanner recognizes literal Node/Vitest test calls and Go benchmark declarations. Dynamic names, generated suites, and custom runners are not guessed. Go candidates use the containing package directory plus the exact benchmark name; Node candidates use a repository-relative file and only attach a name when a literal is present.

Alternative considered: enumerate tests by executing each runner. Rejected because qualification must stay read-only and usable before dependencies are installed.

### 4. Safety signals block automatic readiness

Bounded source markers for remote URLs, browser APIs, common database clients, process environment gates, and integration/e2e naming create explicit safety flags. They are warnings rather than proof, but any such warning prevents `ready`; an agent or owner must choose the next bounded setup.

Alternative considered: allow automatic local runs with network disabled. Rejected because some tests start real services or mutate local databases before the network failure becomes visible.

### 5. Portfolio input is an operator-owned manifest

The product accepts a small JSON manifest with opaque IDs and paths. Paths are used for inspection but omitted from output. Results preserve input order and qualification is sequential, keeping CPU, disk, and process pressure bounded. No Fleet catalog is compiled into CodeVetter.

Alternative considered: discover sibling repositories automatically. Rejected because CodeVetter is independently operable and sibling directory layout is neither portable nor an authorization boundary.

### 6. Qualification recommends but never executes

The output recipe maps directly onto the existing `profile` operation with conservative default samples and warmups. Running it remains a separate explicit call. This keeps planning read-only and lets agents review safety, dirty state, and representativeness first.

Alternative considered: a one-shot qualify-and-profile portfolio command. Rejected because it would turn a metadata scan into potentially expensive arbitrary code execution.

## Risks / Trade-offs

- **Heuristics miss custom benchmark conventions** → Return `needs_selection` or `no_representative_workload`, expose bounded candidates, and allow future explicit manifest hints.
- **Source markers over-classify safe local tests** → Treat flags as reasons for manual selection, not claims that the test definitely performs external I/O.
- **Large monorepos exceed scan bounds** → Report truncation and package-scoped evidence rather than presenting a complete inventory.
- **A benchmark name does not prove product value** → Keep qualification distinct from profiling and from optimization verification; downstream agents must still establish materiality and correctness.
- **Portfolio paths are sensitive** → Redact them from all returned data and errors while retaining caller-supplied opaque IDs.

## Migration Plan

The change is additive. Add contracts and tests, expose new CLI and MCP operations, run the planner against a local Fleet manifest, and record qualification findings. Existing detection, profiling, flow, and campaign operations remain unchanged. Rollback removes the new operations and module without data migration.
