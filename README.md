# Titan

A file-tree-based terminal manager for parallel agent work.

Organize terminal sessions into folder-based channels and threaded conversations.
Each thread embeds a real PTY terminal — run Claude Code, Aider, shell scripts,
or any CLI tool. Switch between threads without losing context. The Replies view
tells you which threads need attention.

## Why

Running multiple AI coding agents in parallel is increasingly common but the UX
hasn't caught up. Terminal multiplexers (tmux) don't scale visually past 4-5 panes.
Spreadsheet-style status views lack detail. IDE-embedded panels tie you to one editor.

Titan organizes parallel terminal work the way Slack organizes conversations:
channels for context, threads for focus, replies for triage.

## Quick Start

Prerequisites: Node.js 18+, pnpm, Rust (stable), Xcode Command Line Tools (macOS)

```bash
git clone <repo-url>
cd titan
pnpm install
pnpm dev
```

## Architecture

- **Tauri v2** — native macOS window, Rust backend
- **tauri-plugin-pty** — real PTY sessions per thread
- **xterm.js** — terminal rendering
- **React + TypeScript** — UI layer
- **Radix UI** — accessible primitives

## Concepts

- **Channels** — folders in your project tree. Each channel contains threads.
- **Threads** — a terminal session with metadata (status, snooze, unread).
- **Replies** — cross-channel view of threads needing attention (new output or snooze expired).
- **Status** — Active (running), Snoozed (deferred), Done (completed).

## License

MIT
