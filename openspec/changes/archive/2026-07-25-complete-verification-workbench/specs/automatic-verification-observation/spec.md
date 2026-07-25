## ADDED Requirements

### Requirement: Real-product automation uses a qualified support matrix
CodeVetter SHALL identify each real-product automation lane by app class,
start/health contract, owned target, state/auth fixture boundary, network
policy, scenario manifest, observation capabilities, and cleanup contract.

#### Scenario: Supported React application is configured
- **WHEN** a repository matches the qualified React/Vite/Chromium contract and declares deterministic target-owned state
- **THEN** CodeVetter may run real local product scenarios under the repository-owned verifier
- **AND** labels the exact supported class and limitations

#### Scenario: Application class is unsupported
- **WHEN** a repository cannot satisfy a qualified support contract
- **THEN** CodeVetter keeps its scenarios fixture-backed or manual
- **AND** does not describe them as real-product automation

### Requirement: App classes graduate through reproducible gates
A new app class MUST pass repeatability, isolation, automatic observation,
cancellation, source identity, resource, artifact retention, and cleanup gates
before CodeVetter presents it as supported.

#### Scenario: Browser run works once but leaks state
- **WHEN** the candidate lane passes behavior once but fails isolation or cleanup
- **THEN** qualification fails
- **AND** the support matrix records the remaining gap
