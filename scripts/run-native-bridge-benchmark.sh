#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
REPOSITORY_ROOT=$(CDPATH='' cd -- "$SCRIPT_DIR/.." && pwd)
ARTIFACT_DIR="$REPOSITORY_ROOT/artifacts/native-bridge"
RUST_MANIFEST="$REPOSITORY_ROOT/apps/desktop/src-tauri/Cargo.toml"
SWIFT_PACKAGE="$REPOSITORY_ROOT/apps/macos/CodeVetterPackage"
BRIDGE_LIBRARY="$ARTIFACT_DIR/libcodevetter_bridge_probe.dylib"
CODEVETTER_CLI="$REPOSITORY_ROOT/apps/desktop/src-tauri/target/release/codevetter"
BENCHMARK_BIN="$SWIFT_PACKAGE/.build/out/Products/Release/NativeBridgeBenchmark"
XCODEBUILDMCP_NPM_CACHE="$ARTIFACT_DIR/xcodebuildmcp-npm-cache"

mkdir -p "$ARTIFACT_DIR" "$XCODEBUILDMCP_NPM_CACHE"
cd "$REPOSITORY_ROOT"

# pnpm projects child npm settings into scripts. Keep the pinned npx invocation
# isolated from package-manager-only keys that npm otherwise warns about.
unset npm_config_user_agent npm_config_verify_deps_before_run \
  npm_config_npm_globalconfig npm_config__jsr_registry npm_config_store_dir 2>/dev/null || true

rustc --crate-type cdylib -O \
  benchmarks/native-bridge/capability_bridge.rs \
  -o "$BRIDGE_LIBRARY"

TAURI_CONFIG='{"bundle":{"externalBin":[]}}' \
  cargo build --release --manifest-path "$RUST_MANIFEST" \
  --features browser-agent --bin codevetter

npm_config_cache="$XCODEBUILDMCP_NPM_CACHE" \
  npm_config_userconfig=/dev/null \
  npm_config_globalconfig="$ARTIFACT_DIR/empty-npmrc" \
  npm_config_update_notifier=false \
  npx -y xcodebuildmcp@2.7.0 swift-package build \
  --package-path "$SWIFT_PACKAGE" \
  --configuration release

if [ ! -x "$BENCHMARK_BIN" ]; then
  echo "XcodeBuildMCP did not produce $BENCHMARK_BIN" >&2
  exit 2
fi

"$BENCHMARK_BIN" "$BRIDGE_LIBRARY" "$CODEVETTER_CLI"
