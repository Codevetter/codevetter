use proc_macro::TokenStream;

/// Preserves the old command annotations as inert metadata while command
/// functions move to transport-neutral Rust APIs.
#[proc_macro_attribute]
pub fn command(_attribute: TokenStream, item: TokenStream) -> TokenStream {
    item
}
