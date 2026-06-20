//! Live browser agent: drives a real Chrome page via chromiumoxide, asks
//! a "brain" (currently LocalAiBrain → local-ai HTTP gateway) for the next
//! action at each step, executes it, and emits per-step events back to the
//! frontend until the goal is reached or the budget is exhausted.

#[cfg(feature = "browser-agent")]
pub mod brain;
#[cfg(feature = "browser-agent")]
pub mod browser;
#[cfg(feature = "browser-agent")]
pub mod cli_brain;
pub mod local_server;
#[cfg(feature = "browser-agent")]
pub mod prompts;
#[cfg(feature = "browser-agent")]
pub mod runner;
pub mod types;

#[cfg(feature = "browser-agent")]
pub use runner::run_agent_task;
#[cfg(feature = "browser-agent")]
pub use types::{AgentRunInput, AgentRunResult};
