pub mod db;
pub mod embedder;
pub mod types;

use std::path::PathBuf;
use std::sync::Mutex;

use db::RagDb;
use embedder::Embedder;
use types::RawChunk;

/// Maximum characters of output to embed (roughly ~2048 tokens).
const MAX_EMBED_CHARS: usize = 8192;

/// Central RAG pipeline state, managed as Tauri app state.
///
/// The embedder is optional and configurable at runtime. If no model
/// directory is configured (or the model files are missing), chunks
/// are stored without embeddings and semantic search is disabled.
/// Recent/get operations always work regardless of embedder state.
pub struct RagState {
    pub db: Option<RagDb>,
    pub embedder: Mutex<Option<Embedder>>,
    pub db_path: PathBuf,
    pub model_dir: Mutex<Option<PathBuf>>,
}

impl RagState {
    /// Initialize RAG state. The database is opened immediately.
    /// The embedder is only initialized if `model_dir` is Some and contains valid model files.
    pub fn new(db_path: PathBuf, model_dir: Option<PathBuf>) -> Self {
        let db = match RagDb::open(&db_path) {
            Ok(db) => {
                eprintln!("[rag] Database opened at {}", db_path.display());
                Some(db)
            }
            Err(e) => {
                eprintln!("[rag] Failed to open database: {e}");
                None
            }
        };

        let embedder = model_dir
            .as_ref()
            .and_then(|dir| match Embedder::new(dir) {
                Ok(emb) => {
                    eprintln!("[rag] Embedder initialized from {}", dir.display());
                    Some(emb)
                }
                Err(e) => {
                    eprintln!("[rag] Embedder not available: {e}");
                    None
                }
            });

        Self {
            db,
            embedder: Mutex::new(embedder),
            db_path,
            model_dir: Mutex::new(model_dir),
        }
    }

    /// Reconfigure the embedding model at runtime.
    /// Pass `None` to disable semantic search entirely.
    /// Pass `Some(path)` to point to a directory containing model.onnx + tokenizer.json.
    pub fn configure_model(&self, model_dir: Option<PathBuf>) -> Result<bool, String> {
        let new_embedder = model_dir
            .as_ref()
            .map(|dir| {
                Embedder::new(dir)
                    .map_err(|e| format!("Failed to initialize embedder from {}: {e}", dir.display()))
            })
            .transpose()?;

        let enabled = new_embedder.is_some();

        let mut emb_lock = self.embedder.lock().map_err(|e| format!("Lock error: {e}"))?;
        *emb_lock = new_embedder;

        let mut dir_lock = self.model_dir.lock().map_err(|e| format!("Lock error: {e}"))?;
        *dir_lock = model_dir;

        Ok(enabled)
    }

    /// Ingest a chunk: embed it (if embedder available) and store in DB.
    pub fn ingest(&self, chunk: RawChunk) -> Result<i64, String> {
        let db = self.db.as_ref().ok_or("RAG database not initialized")?;

        // Prepare text for embedding: command + truncated output
        let embed_text = prepare_for_embedding(&chunk);

        // Generate embedding if embedder is available
        let embedding = {
            let mut emb_guard = self.embedder.lock().map_err(|e| format!("Embedder lock: {e}"))?;
            if let Some(ref mut emb) = *emb_guard {
                match emb.embed(&embed_text) {
                    Ok(vec) => Some(vec),
                    Err(e) => {
                        eprintln!("[rag] Embedding failed, storing without vector: {e}");
                        None
                    }
                }
            } else {
                None
            }
        };

        db.insert_chunk(
            &chunk.session_id,
            &chunk.thread_id,
            chunk.timestamp,
            chunk.cwd.as_deref(),
            &chunk.command,
            &chunk.output,
            embedding.as_deref(),
        )
    }

    /// Semantic search over stored chunks.
    pub fn search(
        &self,
        query: &str,
        limit: usize,
        thread_id: Option<&str>,
    ) -> Result<Vec<types::SearchResult>, String> {
        let db = self.db.as_ref().ok_or("RAG database not initialized")?;

        let mut emb_guard = self
            .embedder
            .lock()
            .map_err(|e| format!("Embedder lock: {e}"))?;

        let emb = emb_guard
            .as_mut()
            .ok_or("Semantic search disabled — no embedding model configured. Set a model directory in Settings to enable.")?;

        let query_embedding = emb.embed(query)?;
        drop(emb_guard);

        db.search(&query_embedding, limit, thread_id)
    }

    /// Get recent chunks (no embedding needed).
    pub fn recent(
        &self,
        n: usize,
        thread_id: Option<&str>,
    ) -> Result<Vec<types::SearchResult>, String> {
        let db = self.db.as_ref().ok_or("RAG database not initialized")?;
        db.recent(n, thread_id)
    }

    /// Delete all RAG data for a thread.
    pub fn delete_thread(&self, thread_id: &str) -> Result<usize, String> {
        let db = self.db.as_ref().ok_or("RAG database not initialized")?;
        db.delete_by_thread_id(thread_id)
    }

    /// Get full chunk by ID.
    pub fn get_chunk(&self, chunk_id: i64) -> Result<types::FullChunk, String> {
        let db = self.db.as_ref().ok_or("RAG database not initialized")?;
        db.get_chunk(chunk_id)
    }
}

/// Prepare chunk text for embedding: "$ command\noutput" with truncation.
fn prepare_for_embedding(chunk: &RawChunk) -> String {
    let output_truncated = if chunk.output.len() > MAX_EMBED_CHARS {
        let mut end = MAX_EMBED_CHARS;
        while !chunk.output.is_char_boundary(end) {
            end -= 1;
        }
        &chunk.output[..end]
    } else {
        &chunk.output
    };

    format!("$ {}\n{}", chunk.command, output_truncated)
}
