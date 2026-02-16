use rusqlite::{params, Connection};
use std::path::Path;
use std::sync::Mutex;

use super::types::{FullChunk, SearchResult};

/// Manages the workspace SQLite database for PTY RAG storage.
pub struct RagDb {
    conn: Mutex<Connection>,
}

impl RagDb {
    /// Open (or create) the workspace database at the given path.
    /// Creates pty_chunks table and the vec0 virtual table if sqlite-vec is available.
    pub fn open(db_path: &Path) -> Result<Self, String> {
        let conn = Connection::open(db_path).map_err(|e| format!("Failed to open DB: {e}"))?;

        // Enable WAL mode for better concurrent read/write performance
        conn.execute_batch("PRAGMA journal_mode=WAL;")
            .map_err(|e| format!("Failed to set WAL mode: {e}"))?;

        // Create chunk metadata + full text table
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS pty_chunks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                thread_id TEXT NOT NULL,
                timestamp REAL NOT NULL,
                cwd TEXT,
                command TEXT NOT NULL,
                output TEXT,
                output_preview TEXT,
                embedding BLOB
            );

            CREATE INDEX IF NOT EXISTS idx_pty_chunks_session
                ON pty_chunks(session_id);
            CREATE INDEX IF NOT EXISTS idx_pty_chunks_thread
                ON pty_chunks(thread_id);
            CREATE INDEX IF NOT EXISTS idx_pty_chunks_timestamp
                ON pty_chunks(timestamp DESC);",
        )
        .map_err(|e| format!("Failed to create tables: {e}"))?;

        // Try to load sqlite-vec and create the virtual table.
        // This is optional — if sqlite-vec isn't available, we fall back to
        // brute-force cosine similarity in Rust.
        let has_vec = Self::try_init_vec_table(&conn);
        if !has_vec {
            eprintln!("[rag] sqlite-vec not available, will use brute-force vector search");
        }

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Attempt to create the vec0 virtual table. Returns true if successful.
    fn try_init_vec_table(conn: &Connection) -> bool {
        // sqlite-vec must be loaded as an extension. If it's not available,
        // this will fail gracefully.
        let result = conn.execute_batch(
            "CREATE VIRTUAL TABLE IF NOT EXISTS pty_chunks_vec USING vec0(
                embedding float[384]
            );",
        );
        result.is_ok()
    }

    /// Insert a chunk into the database. If an embedding is provided,
    /// also insert into the vec table (if available).
    pub fn insert_chunk(
        &self,
        session_id: &str,
        thread_id: &str,
        timestamp: f64,
        cwd: Option<&str>,
        command: &str,
        output: &str,
        embedding: Option<&[f32]>,
    ) -> Result<i64, String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {e}"))?;

        let output_preview = if output.len() > 500 {
            // Find a valid UTF-8 char boundary at or before byte 500
            let mut end = 500;
            while !output.is_char_boundary(end) {
                end -= 1;
            }
            &output[..end]
        } else {
            output
        };

        let embedding_blob = embedding.map(embedding_to_blob);

        conn.execute(
            "INSERT INTO pty_chunks
             (session_id, thread_id, timestamp, cwd, command, output, output_preview, embedding)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                session_id,
                thread_id,
                timestamp,
                cwd,
                command,
                output,
                output_preview,
                embedding_blob,
            ],
        )
        .map_err(|e| format!("Insert failed: {e}"))?;

        let rowid = conn.last_insert_rowid();

        // Mirror into vec table if we have an embedding
        if let Some(emb) = embedding {
            let blob = embedding_to_blob(emb);
            let _ = conn.execute(
                "INSERT INTO pty_chunks_vec(rowid, embedding) VALUES (?1, ?2)",
                params![rowid, blob],
            );
        }

        Ok(rowid)
    }

    /// Semantic search using sqlite-vec (if available) or brute-force fallback.
    pub fn search(
        &self,
        query_embedding: &[f32],
        limit: usize,
        thread_id: Option<&str>,
    ) -> Result<Vec<SearchResult>, String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {e}"))?;

        // Try sqlite-vec first
        if let Ok(results) =
            Self::search_vec(&conn, query_embedding, limit, thread_id)
        {
            return Ok(results);
        }

        // Fallback: brute-force cosine similarity
        Self::search_brute_force(&conn, query_embedding, limit, thread_id)
    }

    /// Search using sqlite-vec's vec0 MATCH operator.
    fn search_vec(
        conn: &Connection,
        query_embedding: &[f32],
        limit: usize,
        thread_id: Option<&str>,
    ) -> Result<Vec<SearchResult>, rusqlite::Error> {
        let blob = embedding_to_blob(query_embedding);

        let (sql, limit_val) = if thread_id.is_some() {
            // When filtering by thread, fetch more from vec then filter
            let sql = format!(
                "SELECT c.id, c.session_id, c.thread_id, c.timestamp, c.cwd,
                        c.command, c.output_preview, v.distance
                 FROM pty_chunks_vec v
                 INNER JOIN pty_chunks c ON c.id = v.rowid
                 WHERE v.embedding MATCH ?1 AND c.thread_id = ?3
                 ORDER BY v.distance
                 LIMIT ?2"
            );
            (sql, limit * 5) // over-fetch to account for thread filter
        } else {
            let sql =
                "SELECT c.id, c.session_id, c.thread_id, c.timestamp, c.cwd,
                        c.command, c.output_preview, v.distance
                 FROM pty_chunks_vec v
                 INNER JOIN pty_chunks c ON c.id = v.rowid
                 WHERE v.embedding MATCH ?1
                 ORDER BY v.distance
                 LIMIT ?2"
                    .to_string();
            (sql, limit)
        };

        let mut stmt = conn.prepare(&sql)?;

        // Collect eagerly in each branch to avoid closure type mismatch
        let row_mapper = |row: &rusqlite::Row| {
            Ok(SearchResult {
                id: row.get(0)?,
                session_id: row.get(1)?,
                thread_id: row.get(2)?,
                timestamp: row.get(3)?,
                cwd: row.get(4)?,
                command: row.get(5)?,
                output_preview: row.get::<_, Option<String>>(6)?
                    .unwrap_or_default(),
                distance: row.get(7)?,
            })
        };

        let mut results: Vec<SearchResult> = if thread_id.is_some() {
            stmt.query_map(
                params![blob, limit_val as i64, thread_id.unwrap()],
                row_mapper,
            )?
            .filter_map(|r| r.ok())
            .collect()
        } else {
            stmt.query_map(params![blob, limit_val as i64], row_mapper)?
                .filter_map(|r| r.ok())
                .collect()
        };

        results.truncate(limit);
        Ok(results)
    }

    /// Brute-force cosine similarity search when sqlite-vec is not available.
    fn search_brute_force(
        conn: &Connection,
        query_embedding: &[f32],
        limit: usize,
        thread_id: Option<&str>,
    ) -> Result<Vec<SearchResult>, String> {
        let sql = if thread_id.is_some() {
            "SELECT id, session_id, thread_id, timestamp, cwd, command, output_preview, embedding
             FROM pty_chunks
             WHERE embedding IS NOT NULL AND thread_id = ?1"
        } else {
            "SELECT id, session_id, thread_id, timestamp, cwd, command, output_preview, embedding
             FROM pty_chunks
             WHERE embedding IS NOT NULL"
        };

        let mut stmt = conn.prepare(sql).map_err(|e| format!("Query failed: {e}"))?;

        let row_mapper = |row: &rusqlite::Row| {
            let emb_blob: Vec<u8> = row.get(7)?;
            Ok((
                SearchResult {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    thread_id: row.get(2)?,
                    timestamp: row.get(3)?,
                    cwd: row.get(4)?,
                    command: row.get(5)?,
                    output_preview: row.get::<_, Option<String>>(6)?
                        .unwrap_or_default(),
                    distance: None,
                },
                emb_blob,
            ))
        };

        let rows: Vec<(SearchResult, Vec<u8>)> = if let Some(tid) = thread_id {
            stmt.query_map(params![tid], row_mapper)
                .map_err(|e| format!("Query failed: {e}"))?
                .filter_map(|r| r.ok())
                .collect()
        } else {
            stmt.query_map([], row_mapper)
                .map_err(|e| format!("Query failed: {e}"))?
                .filter_map(|r| r.ok())
                .collect()
        };

        let mut scored: Vec<(SearchResult, f64)> = rows
            .into_iter()
            .map(|(mut result, emb_blob)| {
                let stored_emb = blob_to_embedding(&emb_blob);
                let dist = cosine_distance(query_embedding, &stored_emb);
                result.distance = Some(dist);
                (result, dist)
            })
            .collect();

        // Sort by distance (lower = more similar)
        scored.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
        scored.truncate(limit);

        Ok(scored.into_iter().map(|(r, _)| r).collect())
    }

    /// Get the N most recent chunks, optionally filtered by thread.
    pub fn recent(
        &self,
        n: usize,
        thread_id: Option<&str>,
    ) -> Result<Vec<SearchResult>, String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {e}"))?;

        let sql = if thread_id.is_some() {
            "SELECT id, session_id, thread_id, timestamp, cwd, command, output_preview
             FROM pty_chunks
             WHERE thread_id = ?1
             ORDER BY timestamp DESC
             LIMIT ?2"
        } else {
            "SELECT id, session_id, thread_id, timestamp, cwd, command, output_preview
             FROM pty_chunks
             ORDER BY timestamp DESC
             LIMIT ?1"
        };

        let mut stmt = conn.prepare(sql).map_err(|e| format!("Query failed: {e}"))?;

        let row_mapper = |row: &rusqlite::Row| {
            Ok(SearchResult {
                id: row.get(0)?,
                session_id: row.get(1)?,
                thread_id: row.get(2)?,
                timestamp: row.get(3)?,
                cwd: row.get(4)?,
                command: row.get(5)?,
                output_preview: row.get::<_, Option<String>>(6)?
                    .unwrap_or_default(),
                distance: None,
            })
        };

        let results: Vec<SearchResult> = if let Some(tid) = thread_id {
            stmt.query_map(params![tid, n as i64], row_mapper)
                .map_err(|e| format!("Query failed: {e}"))?
                .filter_map(|r| r.ok())
                .collect()
        } else {
            stmt.query_map(params![n as i64], row_mapper)
                .map_err(|e| format!("Query failed: {e}"))?
                .filter_map(|r| r.ok())
                .collect()
        };

        Ok(results)
    }

    /// Get the full output of a specific chunk by ID.
    pub fn get_chunk(&self, chunk_id: i64) -> Result<FullChunk, String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {e}"))?;

        conn.query_row(
            "SELECT id, session_id, thread_id, timestamp, cwd, command, output
             FROM pty_chunks WHERE id = ?1",
            params![chunk_id],
            |row| {
                Ok(FullChunk {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    thread_id: row.get(2)?,
                    timestamp: row.get(3)?,
                    cwd: row.get(4)?,
                    command: row.get(5)?,
                    output: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                })
            },
        )
        .map_err(|e| format!("Chunk not found: {e}"))
    }
}

/// Convert f32 slice to little-endian byte blob for SQLite storage.
fn embedding_to_blob(embedding: &[f32]) -> Vec<u8> {
    embedding.iter().flat_map(|f| f.to_le_bytes()).collect()
}

/// Convert byte blob back to f32 vec.
fn blob_to_embedding(blob: &[u8]) -> Vec<f32> {
    blob.chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect()
}

/// Cosine distance between two vectors (1 - cosine_similarity).
fn cosine_distance(a: &[f32], b: &[f32]) -> f64 {
    if a.len() != b.len() || a.is_empty() {
        return 2.0; // max distance
    }
    let mut dot = 0.0f64;
    let mut norm_a = 0.0f64;
    let mut norm_b = 0.0f64;
    for (x, y) in a.iter().zip(b.iter()) {
        let x = *x as f64;
        let y = *y as f64;
        dot += x * y;
        norm_a += x * x;
        norm_b += y * y;
    }
    let denom = norm_a.sqrt() * norm_b.sqrt();
    if denom == 0.0 {
        return 2.0;
    }
    1.0 - (dot / denom)
}
