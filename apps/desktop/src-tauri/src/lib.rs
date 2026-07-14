// Tauri command handlers intentionally keep their stable, flat IPC argument
// contracts. Bundling those parameters into Rust-only structs would complicate
// serialization and silently change the frontend command ABI.
#![allow(clippy::too_many_arguments)]

//! Shared CodeVetter backend library.
//!
//! Tauri and the local MCP sidecar call the same typed graph/history services.
//! Transport adapters must not duplicate SQL or graph interpretation.

pub mod agent;
pub mod commands;
pub mod db;
pub mod mcp;
pub mod talk;
pub mod timeutil;

use std::sync::{Arc, Mutex};

/// Shared database state accessible from Tauri commands.
#[derive(Clone)]
pub struct DbState(pub Arc<Mutex<rusqlite::Connection>>);
