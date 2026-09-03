# Native Agent Island settings parity — 2026-09-02

## Verdict

The Agent Island configuration contract is transferred. Rust, the
`codevetter settings` CLI, the native Settings desk, and the retained supervised
helper use the same 12 non-secret preference keys, defaults, and bounded option
sets. Agent Island remains opt-in and off by default.

The live runtime is not transferred. The new Evidence Workbench does not launch
the helper, inspect live session content, speak updates, preview real provider
output, or action provider requests. Agent and MCP surfaces have no Agent Island
authority. The native desk therefore labels configuration as live and runtime
transfer as pending.

## Canonical preference contract

| Key | Default | Allowed values |
| --- | --- | --- |
| `native_agent_island_enabled` | `false` | boolean |
| `native_agent_island_speech_muted` | `false` | boolean |
| `native_agent_island_speak_completion` | `true` | boolean |
| `native_agent_island_speak_attention` | `true` | boolean |
| `native_agent_island_speak_failure` | `true` | boolean |
| `native_agent_island_speech_volume` | `0.8` | `0.5`, `0.8`, `1` |
| `native_agent_island_speech_rate` | `0.48` | `0.4`, `0.48`, `0.56` |
| `native_agent_island_speech_cooldown` | `30` | `15`, `30`, `60` seconds |
| `native_agent_island_quiet_start` | off | off, `20`, `21`, `22`, `23` |
| `native_agent_island_quiet_end` | off | off, `6`, `7`, `8`, `9` |
| `native_agent_island_codex_voice` | empty | at most 256 non-control characters |
| `native_agent_island_claude_voice` | empty | at most 256 non-control characters |

The receipt schema remains `codevetter.native-settings/v1`. Unknown keys,
invalid options, duplicate keys, partial Agent Island contracts, and projected
`github_token` values fail closed. No session, prompt, output, command, path,
provider response, credential, or voice sample enters the preview.

## Qualification

- An isolated-app-data CLI smoke listed exactly 12 `agent_island` rows, saved
  only `native_agent_island_enabled=true`, returned that exact `saved_key`, and
  continued to declare `github_token` excluded.
- Rust unit coverage verifies the 12-row contract, save round trip, and the
  256-character voice-identifier bound.
- `pnpm test:native` passed 76 Swift package tests with no failures or skips in
  29.8 seconds; the native Debug app then compiled in 2.2 seconds.
- Swift rejects a schema-v1 receipt missing even one Agent Island preference.
- Deterministic 2560x1600 dark and light renders were inspected. The light pass
  found and fixed inherited dark text inside the always-black status capsule.

| Render | SHA-256 |
| --- | --- |
| `settings-agent-island.png` | `df36cb66ed120f7eac2e0387379484e54fdf67e99f1a68e0daa5a820227bf158` |
| `settings-agent-island-light.png` | `2073326d72cfd6fee7a1ed64074663388f2f1381d11c53ee8a5610c4398e0799` |

No helper, installed application, foreground automation, provider process,
network listener, release, signing, notarization, or deployment action was
started by this qualification.
