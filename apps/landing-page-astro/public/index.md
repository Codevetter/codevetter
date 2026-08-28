# CodeVetter

Execution-backed verification and evaluation for coding agents.

## What it is

- Reproducible runtime evidence for agent changes
- Deterministic and calibrated graders
- Machine-readable verification bundles through CLI and MCP
- Local SQLite storage and a Tauri desktop viewer
- Open source (ISC)

## Who it's for

Engineers evaluating or shipping coding-agent changes who need executable evidence before accepting a result — without uploading the repository to a CodeVetter server.

## Current availability

- Apple-silicon macOS build through GitHub Releases
- Packaged local CLI and stdio MCP sidecars inside the desktop distribution
- No separately published npm package, hosted verification API, Homebrew cask, or other platform installer
- Optional provider-backed review sends selected context directly to the provider configured by the user
- No CodeVetter checkout, paid API, hosted verification service, or team subscription

## Agent entrypoints

- https://codevetter.com/llms.txt
- https://codevetter.com/api/ai
- https://codevetter.com/index.md
- https://codevetter.com/docs.md
- https://codevetter.com/benchmark.md
- https://codevetter.com/pricing.md
- https://codevetter.com/.well-known/ai-catalog.json
