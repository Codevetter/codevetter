## Purpose

Provide bounded request-correlated evidence about CPU consumed by observable Node Worker threads without inspecting application values or claiming exclusive causation.

## ADDED Requirements

### Requirement: Observe public Node Worker instances without application edits
CodeVetter SHALL observe only Worker instances constructed through the public Node worker module after its owned preload activates, SHALL preserve normal construction and instance behavior, and SHALL NOT modify worker source, options, payloads, messages, environment data, or application code.

#### Scenario: CommonJS and ESM Worker construction
- **WHEN** an application constructs Workers through CommonJS or ESM after the owned preload activates
- **THEN** CodeVetter retains a bounded anonymous Worker inventory while the application receives behavior-compatible Worker instances

#### Scenario: Unobservable execution mechanisms
- **WHEN** CPU belongs to a child process, native thread, libuv pool, Worker created outside the patched public module, or Worker created before admission
- **THEN** CodeVetter leaves that CPU unresolved rather than attributing it to an observed Worker

### Requirement: Capture the request pre-commit Worker interval
On a supported Node runtime, CodeVetter SHALL attempt bounded per-Worker CPU-usage and sampled-profile observations beginning before selected request handler dispatch and ending at the first response commitment. It SHALL retain start and stop offsets, runtime support, admitted overlap, inventory completeness, and observer effect separately from the measured values.

#### Scenario: Supported online Workers
- **WHEN** one selected dynamic request begins while a bounded set of registered Workers is online and no selected dynamic request overlaps
- **THEN** CodeVetter attempts CPU usage and profiles for those Workers and closes them at the response-commit boundary without delaying response commitment for profile persistence

#### Scenario: Worker starts late or exits
- **WHEN** a Worker is not online at admission, starts after dispatch, exits, or cannot complete either observation
- **THEN** its state and the inventory become explicitly incomplete and its missing interval is not converted to zero CPU

#### Scenario: Overlapping dynamic request
- **WHEN** another selected dynamic request overlaps the active Worker capture
- **THEN** the Worker evidence is contaminated and cannot support request-specific routing

### Requirement: Normalize bounded anonymous Worker evidence
CodeVetter SHALL publish only bounded anonymous Worker ordinals, interval offsets, user/system CPU deltas, sampled durations, closed source-scope aggregates, contained source candidates, completeness, and provenance. It SHALL discard raw Worker identities, thread IDs, constructor arguments, filenames passed to the constructor, worker data, messages, profiles, environment values, and absolute paths from public evidence.

#### Scenario: Repository and non-repository samples
- **WHEN** a complete Worker profile contains repository, dependency, generated, runtime, idle, or unresolved frames
- **THEN** CodeVetter publishes closed aggregate categories and only realpath-contained regular repository source candidates

#### Scenario: Malformed or oversized evidence
- **WHEN** raw evidence is malformed, truncated, inconsistent, oversized, escapes the repository, or exceeds a fixed worker or sample bound
- **THEN** normalization fails closed without disrupting the captured application flow

### Requirement: Support older Node runtimes explicitly
CodeVetter SHALL preserve the existing Node flow on runtimes without parent-side Worker CPU usage or profiling APIs and SHALL report the Worker probe as unsupported rather than failing execution or fabricating zero activity.

#### Scenario: Worker APIs unavailable
- **WHEN** the installed Node runtime lacks either required Worker observation API
- **THEN** the browser-server request reports unsupported Worker evidence and the rest of the flow remains usable
