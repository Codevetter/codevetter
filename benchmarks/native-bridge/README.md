# Native bridge benchmark

This benchmark selects the Rust/Swift ownership boundary using the exact
generated capability registry. It compares:

- an in-process Rust dynamic-library read and Swift JSON decode;
- the real supervised `codevetter capabilities --json` worker round trip.

The probe intentionally adds no production dependency. Its FFI symbol exposes
read-only immutable bytes and never passes Rust objects, allocators, database
handles, or verification policy into Swift.

Build the Rust probe and release CLI, then run the Swift executable through the
pinned XcodeBuildMCP Swift-package workflow. The committed measurement receipt
belongs in `evidence/performance/native-bridge-benchmark.json`.

From the repository root:

```bash
pnpm bench:native-bridge
```

The command prints the versioned benchmark receipt to stdout and leaves only
gitignored build products under `artifacts/`, Cargo `target/`, and SwiftPM
`.build/`.

The selection rule is not “always choose the lowest latency.” Bounded,
read-only projections may use an in-process bridge when schema and crash gates
pass. Verification, browser execution, project commands, and other long-running
or risky work remain supervised workers so cancellation and crash isolation do
not depend on the UI process.
