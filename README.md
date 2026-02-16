# Titan

![Titan](/titan.png)

A file-tree-based terminal manager for parallel agent work — with semantic search over terminal history.

Organize terminal sessions into folder-based channels and threaded conversations.
Each thread embeds a real PTY terminal — run Claude Code, Aider, shell scripts,
or any CLI tool. Switch between threads without losing context. The Replies view
tells you which threads need attention. Search lets you find past commands and
output across all sessions using natural language.

## Why

Running multiple AI coding agents in parallel is increasingly common but the UX
hasn't caught up. Terminal multiplexers (tmux) don't scale visually past 4-5 panes.
Spreadsheet-style status views lack detail. IDE-embedded panels tie you to one editor.

Titan organizes parallel terminal work the way Slack organizes conversations:
channels for context, threads for focus, replies for triage.

## Features

- **Multi-terminal sessions** — each thread runs a full PTY shell via xterm.js
- **Folder-based channels** — browse your project tree and organize threads by directory
- **Thread lifecycle** — mark threads Active, Snoozed, Done, or Inactive
- **Replies view** — cross-channel triage for threads with new output or expired snoozes
- **Semantic search** — find past commands and output using natural language (local ONNX embeddings)
- **Recent history** — browse terminal history sorted by time
- **Scheduled messages** — queue commands to run in new threads at a future time
- **Auto-run commands** — configure a default command that runs when new threads spawn
- **Dark / light theme** — toggle between themes, applied to both UI and terminal
- **Resizable panels** — drag dividers to resize the three-panel layout
- **Persistent state** — threads, channels, settings, and theme survive restarts via localStorage

## Quick Start

Prerequisites: Node.js 18+, pnpm, Rust (stable), Xcode Command Line Tools (macOS)

```bash
git clone <repo-url>
cd titan
pnpm install
pnpm dev
```

### Embedding model (optional)

Semantic search requires an ONNX embedding model. Without it, Titan still stores
terminal history and supports recent-history lookup — just no vector search.

1. Download `all-MiniLM-L6-v2` in ONNX format (needs `model.onnx` and `tokenizer.json`):

```bash
apps/desktop/src-tauri/resources/models/download-model.sh
```

2. Or configure the model directory at runtime from **Settings > RAG Model**.

## Architecture

- **Tauri v2** — native desktop window, Rust backend
- **tauri-plugin-pty** — real PTY sessions per thread
- **xterm.js 5** — terminal rendering with fit and web-links addons
- **React 18 + TypeScript** — UI layer with Context + useReducer state management
- **Tailwind CSS 4** — styling
- **Radix UI** — accessible dialog, dropdown, and tooltip primitives
- **SQLite** (rusqlite) — terminal history storage
- **ONNX Runtime** (ort) — local embedding inference (all-MiniLM-L6-v2, 384-dim)
- **sqlite-vec** — vector similarity search (with brute-force cosine fallback)

## Concepts

- **Channels** — folders in your project tree. Each channel contains threads.
- **Threads** — a terminal session with metadata (status, snooze, unread).
- **Replies** — cross-channel view of threads needing attention (new output or snooze expired).
- **Status** — Active (running), Snoozed (deferred), Done (completed), Inactive (no PTY).
- **Search** — semantic or recency-based lookup across all terminal history.

## RAG Pipeline

Terminal output is automatically captured and indexed for search:

1. A shell hook injects invisible sentinel markers at each command boundary
2. The frontend `PtyRagTap` detects sentinels to split output into command/output chunks
3. A fallback timer (30s) and size threshold (4KB) handle non-interactive output (e.g. long-running agents)
4. ANSI escapes are stripped and the text is sent to the Rust backend
5. If an embedding model is configured, the text is embedded into a 384-dim vector
6. Chunks are stored in SQLite with optional vector indexing for semantic search

Search supports filtering by thread and returns ranked results with relevance scores.

## Project Structure

```
titan/
├── apps/desktop/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Layout.tsx          # Three-panel resizable shell
│   │   │   ├── Sidebar.tsx         # Folder tree, navigation, folder picker
│   │   │   ├── ThreadList.tsx      # Thread groups, context menu, new thread dialog
│   │   │   ├── TerminalManager.tsx # Multi-terminal, toolbar, PTY lifecycle
│   │   │   ├── RepliesView.tsx     # Unread/snoozed thread triage
│   │   │   ├── PtySearch.tsx       # Semantic + recent history search
│   │   │   └── SettingsView.tsx    # Auto-run command, RAG model config
│   │   ├── App.tsx                 # Entry point, persistence, session restore
│   │   ├── store.ts                # React Context + useReducer state
│   │   ├── types.ts                # TypeScript interfaces
│   │   └── rag.ts                  # PtyRagTap, sentinel detection, Tauri wrappers
│   └── src-tauri/
│       └── src/
│           ├── lib.rs              # Tauri commands (scan_directory, RAG endpoints)
│           └── rag/
│               ├── mod.rs          # RAG state orchestration
│               ├── db.rs           # SQLite schema, vector search, queries
│               ├── embedder.rs     # ONNX tokenization + inference
│               └── types.rs        # RawChunk, SearchResult, FullChunk
```

## License

MIT
