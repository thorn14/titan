mod rag;

use rag::types::{FullChunk, RawChunk, SearchResult};
use rag::RagState;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

#[derive(Serialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub children: Vec<DirEntry>,
}

const SKIP_DIRS: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    ".git",
    ".svn",
    ".hg",
    "__pycache__",
    ".next",
    ".nuxt",
    "build",
];

fn scan_recursive(dir: &Path, depth: u32, max_depth: u32) -> Vec<DirEntry> {
    if depth >= max_depth {
        return Vec::new();
    }

    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };

    let mut result: Vec<DirEntry> = Vec::new();

    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() {
            continue;
        }

        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden directories and known non-project dirs
        if name.starts_with('.') || SKIP_DIRS.contains(&name.as_str()) {
            continue;
        }

        let path = entry.path();
        let children = scan_recursive(&path, depth + 1, max_depth);

        result.push(DirEntry {
            name,
            path: path.to_string_lossy().to_string(),
            children,
        });
    }

    result.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    result
}

#[tauri::command]
fn scan_directory(root: String) -> DirEntry {
    let path = Path::new(&root);
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| root.clone());

    let children = scan_recursive(path, 0, 4);

    DirEntry {
        name,
        path: root,
        children,
    }
}

// ─── RAG Pipeline Commands ──────────────────────────────────────────

/// Ingest a terminal output chunk for embedding and storage.
#[tauri::command]
fn pty_rag_ingest(
    chunk: RawChunk,
    state: tauri::State<'_, RagState>,
) -> Result<i64, String> {
    state.ingest(chunk)
}

/// Semantic search over terminal history.
#[tauri::command]
fn pty_rag_search(
    query: String,
    limit: Option<usize>,
    thread_id: Option<String>,
    state: tauri::State<'_, RagState>,
) -> Result<Vec<SearchResult>, String> {
    let limit = limit.unwrap_or(10);
    state.search(&query, limit, thread_id.as_deref())
}

/// Get recent terminal commands (no embedding needed).
#[tauri::command]
fn pty_rag_recent(
    n: Option<usize>,
    thread_id: Option<String>,
    state: tauri::State<'_, RagState>,
) -> Result<Vec<SearchResult>, String> {
    let n = n.unwrap_or(10);
    state.recent(n, thread_id.as_deref())
}

/// Get the full output of a specific chunk by ID.
#[tauri::command]
fn pty_rag_get(
    chunk_id: i64,
    state: tauri::State<'_, RagState>,
) -> Result<FullChunk, String> {
    state.get_chunk(chunk_id)
}

/// Check RAG pipeline status (is DB available? is embedder available?).
#[tauri::command]
fn pty_rag_status(state: tauri::State<'_, RagState>) -> RagStatusInfo {
    let emb_available = state
        .embedder
        .lock()
        .map(|e| e.is_some())
        .unwrap_or(false);
    let model_dir = state
        .model_dir
        .lock()
        .ok()
        .and_then(|d| d.as_ref().map(|p| p.to_string_lossy().to_string()));

    RagStatusInfo {
        db_available: state.db.is_some(),
        embedder_available: emb_available,
        db_path: state.db_path.to_string_lossy().to_string(),
        model_dir,
    }
}

/// Configure the embedding model directory at runtime.
/// Pass `null` / `None` to disable semantic search entirely.
/// Pass a path to a directory containing model.onnx + tokenizer.json to enable.
#[tauri::command]
fn pty_rag_configure_model(
    model_dir: Option<String>,
    state: tauri::State<'_, RagState>,
) -> Result<RagConfigureResult, String> {
    let path = model_dir.map(PathBuf::from);
    let enabled = state.configure_model(path)?;
    Ok(RagConfigureResult { enabled })
}

#[derive(Serialize)]
struct RagStatusInfo {
    db_available: bool,
    embedder_available: bool,
    db_path: String,
    model_dir: Option<String>,
}

#[derive(Serialize)]
struct RagConfigureResult {
    enabled: bool,
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_pty::init())
        .setup(|app| {
            // Resolve paths for RAG pipeline
            let app_data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| dirs::data_dir().unwrap_or_default().join("com.titan.app"));

            // Ensure data directory exists
            let _ = fs::create_dir_all(&app_data_dir);

            let db_path = app_data_dir.join("pty_rag.db");

            // Model files: check bundled resources first, then app data dir.
            // If neither location has model files, embedder starts disabled.
            let bundled_model_dir = app
                .path()
                .resource_dir()
                .ok()
                .map(|r| r.join("models").join("all-MiniLM-L6-v2"));

            let app_data_model_dir =
                Some(app_data_dir.join("models").join("all-MiniLM-L6-v2"));

            // Use whichever directory actually has model.onnx, or None
            let model_dir = bundled_model_dir
                .filter(|d| d.join("model.onnx").exists())
                .or_else(|| app_data_model_dir.filter(|d| d.join("model.onnx").exists()));

            eprintln!("[rag] DB path: {}", db_path.display());
            match &model_dir {
                Some(dir) => eprintln!("[rag] Model dir: {}", dir.display()),
                None => eprintln!("[rag] No model found — semantic search disabled. Configure in Settings."),
            }

            let rag_state = RagState::new(db_path, model_dir);
            app.manage(rag_state);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            scan_directory,
            pty_rag_ingest,
            pty_rag_search,
            pty_rag_recent,
            pty_rag_get,
            pty_rag_status,
            pty_rag_configure_model,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
