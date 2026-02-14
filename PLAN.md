# Plan: Attach a Git Branch to Each Thread

## Overview

Titan threads represent parallel agent work sessions backed by real PTY terminals. This feature would associate a **git branch** with each thread, so that switching between threads also switches the git context. This turns Titan into a workspace manager where each thread is a self-contained unit of work tied to a specific branch.

---

## Data Model Changes

### 1. Extend the `Thread` interface (`src/types.ts`)

Add these fields to `Thread`:

```typescript
branch: string | null;        // Git branch name (e.g. "feat/login-page")
branchAutoCreated: boolean;   // Whether Titan created the branch (vs. user-selected existing)
```

A `null` branch means "no branch attached" — the thread operates in whatever branch the terminal happens to be on (current behavior).

### 2. Extend the reducer (`src/store.ts`)

Add new actions:

- **`ATTACH_BRANCH`** — Set `thread.branch` to a branch name (existing or new)
- **`DETACH_BRANCH`** — Set `thread.branch` back to `null`

Update `CREATE_THREAD` to accept an optional `branch` field.

---

## Backend / Rust Changes

### 3. Add git helper commands (`src-tauri/src/lib.rs`)

New Tauri commands that the frontend can invoke:

| Command | Purpose |
|---|---|
| `git_current_branch(path)` | Returns the current branch name for a repo at `path` |
| `git_list_branches(path)` | Returns all local branch names for the repo |
| `git_branch_exists(path, branch)` | Checks if a branch exists |
| `git_create_branch(path, branch, base?)` | Creates a new branch (optionally from a base) |

These use `std::process::Command` to call `git` — no heavy git library needed. The `path` would be derived from the channel's directory path or the `rootPath`.

**Why Rust and not just shell commands in the PTY?**
- Structured return values (JSON) vs. parsing terminal output
- Error handling with proper Result types
- No interference with the user's terminal session

---

## Frontend / UI Changes

### 4. Thread creation flow — branch picker (`src/components/ThreadList.tsx`)

When creating a thread, add an **optional branch selector** below the compose bar:

- A small toggle/button (e.g., a git branch icon) next to the send button
- When toggled open, shows:
  - **Text input** for a new branch name (auto-slugified from the thread title as a suggestion)
  - **Dropdown** of existing branches (fetched via `git_list_branches`)
  - **"No branch"** option (default — current behavior)
- On thread creation, if a branch is specified:
  1. If the branch doesn't exist, create it via `git_create_branch`
  2. Store the branch name on the thread
  3. The PTY's initial command could include `git checkout <branch>` (or the user does it manually)

### 5. Branch display in thread list (`src/components/ThreadList.tsx`)

In the `ThreadRow` component, show the branch name as a small badge/label:

```
  ● feat/login-page
    Implement login page with OAuth support
    Building components...                   5m  ⏺️ ▶
```

- Branch name styled as a subtle tag (e.g., monospace, muted color)
- Truncated with ellipsis if too long
- Hidden if `branch` is `null`

### 6. Branch switching on thread selection (`src/components/TerminalManager.tsx`)

When the user **selects a thread** that has a branch attached:

- **Option A (Passive — Recommended for v1):** Show a notification/banner in the terminal area: _"This thread is on branch `feat/login-page`. Run `git checkout feat/login-page` to switch."_ This avoids surprising the user with automatic checkouts.
- **Option B (Active):** Automatically write `git checkout <branch>\n` to the PTY. Risky if there are uncommitted changes, stash conflicts, etc.

Recommendation: Start with **Option A** (passive) and add an "auto-checkout" toggle later.

### 7. Context menu additions (`src/components/ThreadList.tsx`)

Add to the right-click context menu:

- **"Attach branch..."** — Opens branch picker (for threads without a branch)
- **"Detach branch"** — Removes the branch association
- **"Copy branch name"** — Copies `thread.branch` to clipboard

### 8. Branch indicator in Sidebar Replies (`src/components/Sidebar.tsx`)

In the "Replies" section (cross-channel unread/due threads), also display the branch name so users can tell which branch needs attention without opening the thread.

---

## Persistence

### 9. Persist thread state

Currently all thread state is in-memory only. Branch associations should survive app restarts. Two options:

- **Option A (Minimal — Recommended for v1):** Serialize the `threads` array to a JSON file in the project root (e.g., `.titan/state.json`) on every state change (debounced). Load on startup.
- **Option B (Full):** Add SQLite via `tauri-plugin-sql` for structured persistence.

Recommendation: Start with **Option A** — a simple JSON file. This also makes branch associations visible/editable by hand.

---

## File Change Summary

| File | Changes |
|---|---|
| `src/types.ts` | Add `branch`, `branchAutoCreated` to `Thread`; add `gitStatus` to `AppState` |
| `src/store.ts` | Add `ATTACH_BRANCH`, `DETACH_BRANCH`, `SET_GIT_STATUS` actions; update `CREATE_THREAD` |
| `src-tauri/src/lib.rs` | Add `git_status`, `git_current_branch`, `git_list_branches`, `git_branch_exists`, `git_create_branch` commands |
| `src/components/ThreadList.tsx` | Branch picker in compose bar (conditionally rendered), branch badge in thread rows, context menu items |
| `src/components/TerminalManager.tsx` | Branch reminder banner on thread selection |
| `src/components/Sidebar.tsx` | Call `git_status` on folder pick; branch name in Replies section |
| `src/styles.css` | Styles for branch badge, branch picker, banner, warning messages |
| `src/App.tsx` | (If adding persistence) Load/save state to `.titan/state.json` |

---

## Implementation Order

1. **Git detection backend** — `lib.rs`: `git_status` command (enables everything else)
2. **Data model** — `types.ts` + `store.ts`: `gitStatus` in state, `branch` on Thread, new actions
3. **Git detection frontend** — `Sidebar.tsx`: call `git_status` on folder pick, store result
4. **Rust git commands** — `lib.rs`: `git_list_branches`, `git_create_branch`, etc.
5. **Branch badge in thread rows** — `ThreadList.tsx` + `styles.css` (conditionally rendered)
6. **Branch picker on thread creation** — `ThreadList.tsx` (conditionally rendered)
7. **Context menu actions** — `ThreadList.tsx` (attach/detach/copy)
8. **Branch reminder banner** — `TerminalManager.tsx` (selection-time hint)
9. **Sidebar branch display** — `Sidebar.tsx` (replies section)
10. **Persistence** — `App.tsx` + `.titan/state.json` (survive restarts)

---

## Git Availability Detection

### 10. Add a `git_status` Tauri command (`src-tauri/src/lib.rs`)

Before any branch UI is shown, the app needs to know whether git is usable. Add a single detection command:

```rust
#[tauri::command]
fn git_status(path: String) -> GitStatus { ... }
```

Returns a struct like:

```rust
struct GitStatus {
    git_installed: bool,    // Can we run `git --version`?
    is_repo: bool,          // Is `path` inside a git work tree?
    user_configured: bool,  // Are user.name and user.email set?
}
```

Detection logic:
1. Run `git --version` — if it fails, `git_installed = false`, stop.
2. Run `git -C <path> rev-parse --is-inside-work-tree` — if it fails, `is_repo = false`, stop.
3. Run `git -C <path> config user.name` and `git -C <path> config user.email` — if either is empty, `user_configured = false`.

### 11. Add `gitStatus` to AppState (`src/types.ts`, `src/store.ts`)

```typescript
// In AppState:
gitStatus: {
  gitInstalled: boolean;
  isRepo: boolean;
  userConfigured: boolean;
} | null;  // null = not yet checked
```

New action: **`SET_GIT_STATUS`** — called once when `rootPath` is set (in `Sidebar.tsx` after folder pick) and stores the result.

### 12. Conditional UI based on git status (`src/components/ThreadList.tsx`)

The branch feature UI is **entirely hidden** unless git is available and the project is a repo:

| `gitInstalled` | `isRepo` | `userConfigured` | Branch UI behavior |
|---|---|---|---|
| `false` | — | — | **Hidden.** No branch icon, no branch picker, no branch badges. Titan works exactly as it does today. |
| `true` | `false` | — | **Hidden.** Same as above — the folder isn't a git repo, so branches don't apply. |
| `true` | `true` | `false` | **Shown with warning.** Branch picker is visible but creating new branches shows a one-time inline warning: _"Git user not configured. Run `git config user.name` and `git config user.email` to enable full git support."_ Attaching to *existing* branches still works. |
| `true` | `true` | `true` | **Fully enabled.** All branch features available. |

Key principles:
- **No git? No problem.** Titan is still fully functional for non-git workflows (editing config files, working in non-versioned directories, etc.). The branch feature simply doesn't exist in the UI.
- **Git repo but no user config?** Branch listing and attaching to existing branches works. Creating branches works too (it doesn't require user.name/email). The warning is informational, not blocking — it's relevant if the user later tries to commit from the thread's terminal.
- **Re-check on folder change.** When the user picks a new root folder, `git_status` is called again. A user might switch from a non-git project to a git project or vice versa.

### 13. Graceful fallback for all git backend commands

Every git Tauri command (`git_list_branches`, `git_create_branch`, etc.) should return a `Result` type. The frontend handles errors by:
- Showing a brief inline error message (not a modal)
- Falling back to "no branch" mode for that thread
- Never crashing or blocking thread creation

Example: if `git_list_branches` fails (repo corrupted, `.git` directory deleted mid-session), the branch picker shows an empty state with a message: _"Could not list branches"_ and the user can still create the thread without a branch.

---

## Edge Cases & Considerations

- **Deleted branches:** If a branch is deleted externally, the thread still references it. Show a "branch missing" warning badge instead of the normal branch badge. The user can detach via context menu.
- **Same branch on multiple threads:** Allow it — branches are informational associations, not exclusive locks.
- **Non-git directories:** All branch UI is hidden. Detected at folder-pick time via `git_status`. See section above.
- **Git not installed:** All branch UI is hidden. Same as non-git directories from the user's perspective.
- **Git user not configured:** Branch UI is shown. Informational warning when creating branches, but not blocking.
- **Git becomes unavailable mid-session:** (e.g., `.git` folder deleted, git uninstalled). Individual git commands fail gracefully with inline errors. Existing branch badges remain visible (they're just strings in state) but operations like "list branches" show empty/error state.
- **Folder changes from git to non-git:** `git_status` re-runs on folder pick. Branch UI hides. Existing threads keep their `branch` field in state (harmless), but badges are not rendered.
- **Submodules / worktrees:** Out of scope for v1. Assume a single repo root.
- **Branch name validation:** Reject names with characters git doesn't allow (spaces, `..`, `~`, `^`, `:`, `\`, etc.).
