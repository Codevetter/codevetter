# Native Work qualification

Recorded 2026-07-20 in the actual Tauri macOS application against the local provider installations and SQLite database.

## Provider lifecycle

- A real local Codex run returned a harmless marker in the bounded direct-output view, stopped intentionally without being presented as a failure, and resumed through the provider-native session contract.
- A real local Claude process launched with the safe default permission mode, accepted input, and stopped intentionally. The installed default Claude profile then refused completion because its organization has disabled subscription access, so a provider session ID was never issued and native resume could not be exercised. CodeVetter preserved the draft and exposed the provider's recovery message.

## Local persistence

- A Work item was created and linked to the exact Codex session.
- After a complete CodeVetter process restart, the Board restored the item and displayed the linked run.
- The item was deleted through the Work UI; the exact SQLite row was absent afterward.

## Evidence handling

Temporary native screenshots covered the Codex response, intentional stop, resume, Claude input, restored Work item, and final empty Board. They were inspected during qualification, were not committed as product artifacts, and contained no durable test data.
