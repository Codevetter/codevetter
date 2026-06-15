use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRunInput {
    pub url: String,
    pub goal: String,
    pub persona: Option<String>,
    /// "claude" | "codex" | "gemini" — passed through to local-ai.
    pub provider: String,
    pub model: Option<String>,
    pub max_steps: Option<u32>,
    /// Optional path to a project directory. When set, the agent spawns the
    /// detected dev command (npm run dev / npm start) and polls `url` until
    /// the server responds, then runs the loop. The dev server is killed
    /// when the run ends.
    pub project_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentAction {
    Click {
        selector: String,
        reasoning: String,
    },
    Type {
        selector: String,
        text: String,
        reasoning: String,
    },
    Key {
        key: String,
        reasoning: String,
    },
    Scroll {
        delta: i32,
        reasoning: String,
    },
    Goto {
        url: String,
        reasoning: String,
    },
    Done {
        reasoning: String,
    },
    GiveUp {
        reasoning: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentStep {
    pub index: u32,
    pub action: AgentAction,
    pub url: String,
    pub page_title: String,
    pub screenshot_path: Option<String>,
    /// `data:image/jpeg;base64,…` so the frontend can render the screenshot
    /// inline without configuring the asset:// scope.
    pub screenshot_data_url: Option<String>,
    pub elapsed_ms: u64,
    /// Time spent capturing URL/title/elements/screenshot.
    pub snapshot_ms: u64,
    /// Time spent waiting for the brain to return an action. Typically the
    /// dominant cost — CLI cold-start is 2-5s per spawn.
    pub brain_ms: u64,
    /// Time spent executing the chosen action against the browser.
    pub exec_ms: u64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRunResult {
    pub run_id: String,
    pub goal: String,
    pub completed: bool,
    pub gave_up: bool,
    pub step_count: u32,
    pub final_url: String,
    pub final_title: String,
    pub duration_ms: u64,
    pub steps: Vec<AgentStep>,
    pub error: Option<String>,
}
