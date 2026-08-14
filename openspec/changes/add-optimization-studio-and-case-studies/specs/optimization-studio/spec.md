## Purpose

Make CodeVetter's bounded local performance laboratory discoverable and usable
from the desktop workbench while preserving the machine receipt as authority.

## ADDED Requirements

### Requirement: Optimize is a first-class workbench destination
The desktop application SHALL expose an Optimize destination through primary
navigation and command search, and it SHALL preserve the selected repository
used by the shared project workspace.

#### Scenario: User opens Optimize
- **WHEN** a user selects Optimize from navigation or command search
- **THEN** the application shows the selected repository, the bounded lab action, and prior receipt evidence for that repository

#### Scenario: User has not selected a repository
- **WHEN** the Optimize destination opens without an active repository
- **THEN** it offers the existing local repository picker and does not start execution

### Requirement: Desktop labs use the packaged bounded runtime
The desktop application SHALL run only CodeVetter's packaged performance-lab
operation with typed bounded inputs and SHALL NOT accept arbitrary commands,
production origins, source patches, or cloud execution settings.

#### Scenario: User starts a local laboratory
- **WHEN** a user starts a lab for an available repository
- **THEN** the application executes the packaged local runtime with a generated bounded lab identity and shows an explicit running state

#### Scenario: Packaged runtime is unavailable
- **WHEN** the local Node runtime or packaged performance resource cannot start
- **THEN** the application shows a recoverable written error and does not claim that profiling occurred

### Requirement: Receipts remain the evidence authority
The desktop application SHALL render laboratory state, steps, summaries, stop
reason, limitations, and artifact identity from the returned receipt without
converting stopped or blocked states into successful optimization claims.

#### Scenario: Laboratory completes or stops
- **WHEN** the packaged runtime returns a valid receipt
- **THEN** the application shows each recorded action and result, the terminal reason, the evidence limitations, and the receipt location

#### Scenario: Previous receipts exist
- **WHEN** the selected repository contains bounded CodeVetter performance-lab receipts
- **THEN** the application lists the newest receipts and lets the user inspect them without rerunning the laboratory

### Requirement: Acceptance includes an enforceable change-cost budget
The performance laboratory SHALL measure the candidate's files changed, added
and removed lines, gross line movement, and production dependency additions,
and SHALL reject candidates that escape their source boundary or exceed the
bounded default change budget even when performance improves.

#### Scenario: A small candidate produces a material verified gain
- **WHEN** correctness and paired performance verification pass and the candidate remains within its source and change-cost budget
- **THEN** the acceptance receipt records the observed change cost and may recommend retaining the candidate

#### Scenario: A candidate adds disproportionate code
- **WHEN** the candidate exceeds the recorded file or line budget, changes files outside the proposed source boundary, or adds an unapproved production dependency
- **THEN** the laboratory rejects the candidate with the violated limits and does not recommend shipping it

#### Scenario: Change cost cannot be established
- **WHEN** CodeVetter cannot obtain a complete bounded change inventory
- **THEN** acceptance returns no confidence rather than treating missing cost evidence as zero
