# Titan Thread Management - Implementation Plan

## Current State Summary

Titan is a Tauri 2 desktop app (React + Rust) that acts as a terminal multiplexer organized by project folders ("channels"). It uses xterm.js + tauri-pty for shell sessions, a React Context/reducer state pattern, and raw CSS with custom properties. There is no persistence beyond `sessionStorage` for the selected channel/thread, no Claude integration, no theming system, and no scheduled send.

---

## Phase 1: Install Tailwind CSS + Stone Grays

**Files:** `package.json`, `vite.config.ts`, `tailwind.config.ts` (new), `src/styles.css`, `src/main.tsx`

1. Install `tailwindcss`, `@tailwindcss/vite`
2. Add the Tailwind Vite plugin to `vite.config.ts`
3. Replace all CSS custom property values with Tailwind stone palette equivalents:
   - `--bg` → `stone-950` (#0c0a09)
   - `--panel` → `stone-900` (#1c1917)
   - `--panel-hover` → `stone-800` (#292524)
   - `--border` → `stone-800` (#292524)
   - `--border-hover` → `stone-700` (#44403c)
   - `--surface` → `stone-700` (#44403c)
   - `--text` → `stone-300` (#d6d3d1)
   - `--text-bright` → `stone-100` (#f5f5f4)
   - `--text-muted` → `stone-400` (#a8a29e)
   - `--text-dim` → `stone-500` (#78716c)
   - `--text-faint` → `stone-600` (#57534e)
   - `--terminal-bg` → `stone-950` (#0c0a09)
4. Update xterm theme colors in `TerminalManager.tsx` to match stone palette
5. Keep existing CSS class structure — just swap the design token values
6. Add `@import "tailwindcss"` to top of `styles.css` so Tailwind utilities are available going forward

---

## Phase 2: Light/Dark Mode

**Files:** `src/styles.css`, `src/store.ts`, `src/types.ts`, `src/components/Sidebar.tsx`, `src/components/TerminalManager.tsx`

1. Add a `theme: "light" | "dark"` field to `AppState` (default: `"dark"`)
2. Add a `TOGGLE_THEME` action to the reducer
3. Define a second set of CSS custom properties under `[data-theme="light"]`:
   - `--bg` → `stone-100`
   - `--panel` → `stone-50` / `white`
   - `--border` → `stone-200`
   - `--text` → `stone-700`
   - `--text-bright` → `stone-900`
   - etc. (full light palette mapping)
4. Apply `data-theme` attribute on `<html>` element in `AppInner` via `useEffect`
5. Add a theme toggle button in the sidebar header (sun/moon icon)
6. For xterm: dynamically update terminal theme when mode changes (call `terminal.options.theme = ...`)
7. Persist theme preference in `localStorage`

---

## Phase 3: Terminal Persistence Across Views

**Files:** `src/components/Layout.tsx`, `src/App.tsx`, `src/components/TerminalManager.tsx`

**Problem:** Currently `Layout.tsx` conditionally renders the terminal panel (`{showTerminal && ...}`). When no thread is selected (e.g., switching channels), the `TerminalManager` unmounts, which triggers its cleanup effect — killing all PTY processes and disposing all terminal instances. When a thread is re-selected, everything respawns from scratch.

**Fix:**
1. **Always render** `TerminalManager` in the DOM — never unmount it
2. Change `Layout.tsx` to always render the right panel but use `display: none` / CSS visibility to hide it when no thread is selected, instead of conditional rendering
3. The `TerminalManager` already manages show/hide per-thread via `containerEl.style.display` — this behavior stays as-is
4. The center panel flex behavior (`flex: 1` when no terminal) can be handled with a CSS class toggle rather than conditional DOM removal

---

## Phase 4: Auto-Run Claude on New Thread

**Files:** `src/components/TerminalManager.tsx`, `src/components/ThreadList.tsx`, `src/store.ts`

**Current behavior:** Creating a thread spawns `/bin/zsh` and the user-typed text becomes the thread `title`. No command is sent to the shell.

**New behavior:**
1. When a new thread is created, after the PTY spawns and the shell is ready, automatically write `claude\n` to the PTY to launch the Claude CLI
2. Add a short delay (~500ms) after shell spawn before sending the command, to allow the shell to initialize
3. The compose bar prompt text is still stored as the thread title for now (will be made optional in Phase 5)
4. Add a `pendingPrompt` field to the `CREATE_THREAD` action. After Claude CLI starts, the prompt text is sent as a follow-up write to the PTY (e.g., type the user's prompt into the Claude REPL)
5. Sequence: spawn zsh → wait → write `claude\n` → wait for Claude to be ready → write the user's prompt + `\n`

**Detection of "Claude ready":** Monitor terminal output for a recognizable prompt indicator (e.g., `>` or a known Claude CLI ready string). Use a simple output watcher that resolves a promise when the pattern is detected, with a timeout fallback (~3s).

---

## Phase 5: Auto-Generated Thread Names (No Name Required)

**Files:** `src/components/ThreadList.tsx`, `src/store.ts`, `src/types.ts`, `src/components/TerminalManager.tsx`

1. Make `title` optional at thread creation — if the compose input is empty, create the thread with `title: "New thread"` (placeholder)
2. Change the compose bar: pressing Enter with empty text creates a thread with placeholder name and auto-runs Claude with no initial prompt
3. If text is provided, it becomes the initial prompt sent to Claude (and temporarily the title)
4. Add a `RENAME_THREAD` action to the reducer
5. **Auto-title generation:** After the first meaningful terminal output (first non-shell-prompt line from Claude), use the first ~60 characters as the thread title via `RENAME_THREAD` dispatch
6. Track whether a thread has been "auto-titled" with a `autoTitled: boolean` field so we don't keep overwriting after the first output

---

## Phase 6: Renameable Threads

**Files:** `src/store.ts`, `src/components/ThreadList.tsx`, `src/components/TerminalManager.tsx`

1. `RENAME_THREAD` action (already added in Phase 5): `{ type: "RENAME_THREAD", threadId: string, title: string }`
2. **In ThreadRow:** Double-click on thread title enters inline edit mode (swap `<span>` for `<input>`)
   - Enter to confirm, Escape to cancel
   - Dispatch `RENAME_THREAD` on confirm
3. **In ThreadToolbar** (terminal header): Make title editable on click — same inline edit pattern
4. **In context menu:** Add a "Rename..." option that triggers edit mode

---

## Phase 7: Replies as a Dedicated View

**Files:** `src/components/Sidebar.tsx`, `src/components/Layout.tsx`, `src/store.ts`, `src/types.ts`, `src/App.tsx`

**Current behavior:** Replies section in sidebar shows a list of unread/snoozed threads inline.

**New behavior:**
1. Remove the inline replies list from the sidebar
2. Replace with a single "Replies" button in the sidebar with an unread count badge
3. Add a `currentView: "threads" | "replies"` field to `AppState`
4. Add a `SET_VIEW` action to switch between views
5. Clicking the "Replies" button dispatches `SET_VIEW: "replies"`
6. When `currentView === "replies"`, the center panel (where ThreadList normally shows) renders a new `RepliesView` component instead
7. `RepliesView` looks like a thread list — shows all unread/snoozed threads across all channels, grouped and styled like a channel's thread list
8. Clicking a reply thread in this view selects it, switches to the terminal, and marks it read
9. Include "Mark all read" button in the RepliesView header
10. Clicking a channel in the sidebar switches back to `currentView: "threads"`

---

## Phase 8: Schedule Send

**Files:** `src/components/ThreadList.tsx`, `src/store.ts`, `src/types.ts`, `src/snooze.ts` (reuse time picker patterns)

1. Add a clock/schedule icon button next to the compose send button
2. Clicking it opens a dropdown with time options (reuse `SNOOZE_OPTIONS` pattern):
   - "In 30 minutes"
   - "In 1 hour"
   - "Tomorrow at 9am"
   - "Custom time..." (basic datetime-local input)
3. Add a `scheduledMessages` array to `AppState`:
   ```ts
   interface ScheduledMessage {
     id: string;
     channelId: string;
     prompt: string;
     scheduledAt: number; // timestamp when to send
   }
   ```
4. Add actions: `SCHEDULE_MESSAGE`, `FIRE_SCHEDULED`, `CANCEL_SCHEDULED`
5. When scheduling: store the message, clear the compose input, show a subtle toast/indicator
6. Add a 30-second interval (similar to `WAKE_SNOOZED`) that checks for due scheduled messages
7. When a scheduled message fires: create a new thread (same as handleSendPrompt) and auto-run the prompt via Claude
8. Show pending scheduled messages somewhere visible — small list below compose bar or as a subtle indicator on the schedule button

---

## Phase 9: Persist Threads Across Sessions

**Files:** `src/store.ts`, `src/App.tsx`, `src/types.ts`

1. Use `localStorage` to persist the full `threads` array and `scheduledMessages`
2. On state changes (thread created, status changed, renamed, etc.), serialize threads to `localStorage` under key `titan:threads`
3. On app startup, read from `localStorage` and hydrate initial state
4. For restored threads: set `ptyRunning: false`, `ptyExitCode: null`, `ptyId: null` (PTY processes don't survive app restarts)
5. When a restored thread is selected, the user can use the "Restart" button to spawn a new PTY
6. Also persist `rootPath` and `selectedChannelId` so the full workspace context restores
7. Consider debouncing localStorage writes (e.g., 1s debounce) to avoid excessive writes during rapid terminal output updates

**Note on memory.json:** Rather than a custom `memory.json` file, `localStorage` is simpler and sufficient for the current scale. If cross-device sync or larger data is needed later, we can migrate to a Tauri file-based store or SQLite.

---

## File Change Summary

| File | Phases |
|------|--------|
| `package.json` | 1 |
| `vite.config.ts` | 1 |
| `tailwind.config.ts` (new) | 1 |
| `src/styles.css` | 1, 2 |
| `src/main.tsx` | 1 |
| `src/types.ts` | 2, 5, 7, 8 |
| `src/store.ts` | 2, 4, 5, 6, 7, 8, 9 |
| `src/App.tsx` | 7, 9 |
| `src/components/Layout.tsx` | 3, 7 |
| `src/components/TerminalManager.tsx` | 1, 2, 4, 5, 6 |
| `src/components/ThreadList.tsx` | 4, 5, 6, 8 |
| `src/components/Sidebar.tsx` | 2, 7 |
| `src/components/RepliesView.tsx` (new) | 7 |

---

## Execution Order

Phases are ordered by dependency:
1. **Tailwind** (1) — foundational, everything else builds on it
2. **Light/Dark Mode** (2) — extends the theme tokens from Phase 1
3. **Terminal Persistence** (3) — critical bug fix, no dependencies
4. **Auto-Run Claude** (4) — depends on terminal working correctly (Phase 3)
5. **Auto-Generated Names** (5) — depends on Phase 4 (Claude output for title)
6. **Renameable Threads** (6) — depends on Phase 5 (RENAME_THREAD action)
7. **Replies View** (7) — independent UI rework
8. **Schedule Send** (8) — independent feature
9. **Persistence** (9) — last, so all state shape changes from other phases are finalized
