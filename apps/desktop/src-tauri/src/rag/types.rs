use serde::{Deserialize, Serialize};

/// A raw chunk of terminal output bounded by two sentinel markers.
/// Sent from the TypeScript frontend to the Rust backend for embedding + storage.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawChunk {
    pub session_id: String,
    pub thread_id: String,
    pub timestamp: f64,
    pub cwd: Option<String>,
    pub command: String,
    pub output: String,
}

/// A search result returned to the frontend or MCP client.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub id: i64,
    pub session_id: String,
    pub thread_id: String,
    pub timestamp: f64,
    pub cwd: Option<String>,
    pub command: String,
    pub output_preview: String,
    pub distance: Option<f64>,
}

/// Full chunk data returned by pty_get.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FullChunk {
    pub id: i64,
    pub session_id: String,
    pub thread_id: String,
    pub timestamp: f64,
    pub cwd: Option<String>,
    pub command: String,
    pub output: String,
}
