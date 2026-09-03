//! Read-only FFI probe for measuring a narrow Rust/Swift data boundary.
//!
//! This is benchmark code, not the production bridge. It exposes the exact
//! Rust-generated capability fixture consumed by the native app so the probe
//! measures boundary overhead without reimplementing product semantics.

static CAPABILITIES: &[u8] = include_bytes!(
    "../../apps/macos/CodeVetterPackage/Sources/CodeVetterFeature/Resources/capabilities.v1.json"
);

#[no_mangle]
pub extern "C" fn codevetter_capabilities_pointer() -> *const u8 {
    CAPABILITIES.as_ptr()
}

#[no_mangle]
pub extern "C" fn codevetter_capabilities_length() -> usize {
    CAPABILITIES.len()
}
