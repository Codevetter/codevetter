---
title: Install the CLI and connect an MCP client
description: Verified Apple-silicon installation and explicit repository-scoped MCP access.
---

# CLI and MCP setup

CodeVetter runs locally on Apple-silicon macOS 14 or later. The CLI and MCP
server need no CodeVetter account. An agent client may have its own account
requirements. MCP exposes existing evidence read-only; it does not execute
checks or run an agent on your behalf.

## Install without opening the desktop app

Review [the installer](../../scripts/install-cli.sh), then run:

```sh
curl --fail --silent --show-error --location \
  https://raw.githubusercontent.com/Codevetter/codevetter/main/scripts/install-cli.sh \
  | bash
```

The installer verifies the GitHub release SHA-256 digest, CodeVetter's
Developer ID signature and macOS Gatekeeper acceptance before installing.
It preserves the signed app payload and runtime resources under
`~/.local/share/codevetter/<version>/`; only `codevetter` and `codevetter-mcp`
are linked into `~/.local/bin`. It never launches the app or changes shell
startup files. This is a headless install of the qualified app payload, not a
claim that a stripped binary has all required resources.

Add `~/.local/bin` to your shell's PATH if needed, or use the full paths:

```sh
~/.local/bin/codevetter --version
~/.local/bin/codevetter capabilities --json
```

Set `CODEVETTER_PREFIX` to choose another absolute installation directory and
`CODEVETTER_VERSION` to pin a stable release. Existing unrelated commands are
never replaced. Upgrades retain older version payloads; reinstalling the same
version stops without changing it. Download staging directories are retained
for inspection, and the installer prints their exact path.

## Prepare one repository

The new `--index-history` option is **unreleased**. Version 1.14.1 requires
opening the repository in the app and selecting **Index history** first;
after that, the existing `mcp --enable` command works. Do not run the new flag
against 1.14.1 and infer successful setup from an error.

With a build containing the headless index option, change into the repository
you want to expose and run:

```sh
codevetter mcp --repo "$PWD" --index-history --enable --json > codevetter-mcp-setup.json
```

This builds the bounded local history index using the same engine as the app,
then explicitly enables one repository's opaque MCP scope. It does not fetch
from Git remotes, install dependencies, run project scripts or call a model.
Without `--enable`, indexing alone leaves access disabled. Re-run indexing
after the repository changes; unavailable or incomplete evidence stays marked.

The receipt contains `settings.enabled`, `settings.indexed`, `settings.stale`
and a generated `settings.client_config`. Use the generated command and
arguments exactly: `--repo-id` is an opaque identifier, not a filesystem path.
The receipt contains machine-local paths; keep it private and out of Git.

## Claude Code

From that repository, register the generated entry in local scope:

```sh
claude mcp add-json --scope local codevetter-history \
  "$(plutil -extract settings.client_config.mcpServers.codevetter-history json \
    -o - codevetter-mcp-setup.json)"
claude mcp get codevetter-history
```

Alternatively, merge `settings.client_config.mcpServers` into the client's
existing `.mcp.json`; preserve other servers. Do not overwrite a populated
configuration with the full receipt. The equivalent entry has this shape:

```json
{
  "mcpServers": {
    "codevetter-history": {
      "command": "/absolute/install/path/CodeVetter.app/Contents/MacOS/codevetter-mcp",
      "args": ["--database", "/absolute/path/codevetter.db", "--repo-id", "generated-id"]
    }
  }
}
```

Reconnect the client, inspect its MCP tool list, and ask it to call
`capability_catalog`. Successful registration alone is not a successful tool
call. The automated fresh-database test exercises initialization, `tools/list`
and a real catalog call using the built CLI and server; it does not claim a
live authenticated Claude conversation. A separate empty Claude configuration
directory was also registered with `add-json`; `claude mcp get` reported
**Connected**, without opening an app or requesting account signup.

## Revoke access

```sh
codevetter mcp --repo "$PWD" --disable --json
claude mcp remove --scope local codevetter-history
```

Disable the scope before removing the client entry. Existing server processes
recheck access. Each additional repository requires its own enable step and
generated entry. See [the MCP reference](../architecture/mcp-sidecar.md) for
tools, redaction, freshness and response limits.
