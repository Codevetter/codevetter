# Pinned Ultracite Biome rules

These three presets are byte-identical to Ultracite 7.12.0, from npm tarball
`sha512-thOrO9IMaEcGjQrwp44W5UNm9muLIY/vVD83hVPhQ5wZncSAQB+qWq6U78QgVAoWaD3mDpkZDvfwF+JLSQtZzg==`.
Upstream commit: `023fd1c93afa348ddfeb95d02d414dce3a36a9ab` ([source](https://github.com/haydenbleasel/ultracite/tree/023fd1c93afa348ddfeb95d02d414dce3a36a9ab)).
The upstream MIT notice is retained in `license.md`.

CodeVetter runs Biome directly and never invokes the Ultracite CLI. Keeping only
its static presets preserves the lint rules while removing the unused CLI
chain that brought in vulnerable braces through fast-glob and micromatch.

| Preset | SHA-256 |
| --- | --- |
| `core.jsonc` | `13ecfbfc8cda3a885d28c523a4053fcbf28321232f898326e9d33d2f56f98527` |
| `react.jsonc` | `78d84b77805bf035e27403588794904c58e4ad040edfe71516474e3a92732cf2` |
| `vitest.jsonc` | `22f23e6c96260e1fd374f2bc3e98b0e5228322954cc129acc2dd810a8a172aaa` |

For an intentional preset update, verify the new npm tarball integrity, copy
the same three upstream files, retain the license, update these hashes, and
review the rule diff before running `pnpm lint` and `pnpm knip:strict`.
