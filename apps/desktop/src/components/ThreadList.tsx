import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { invoke } from "@tauri-apps/api/core";
import {
  type MouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { SNOOZE_OPTIONS } from "../snooze";
import { useAppDispatch, useAppState } from "../store";
import type { Thread, ThreadStatus } from "../types";

let threadCounter = 0;

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

const STATUS_ICONS: Record<ThreadStatus, string> = {
  active: "\u25B6",
  snoozed: "\u23F8",
  done: "\u2713",
};

function ThreadRow({
  thread,
  isSelected,
  showBranch,
  onSelect,
  onContextAction,
}: {
  thread: Thread;
  isSelected: boolean;
  showBranch: boolean;
  onSelect: () => void;
  onContextAction: (
    threadId: string,
    action: string,
    snoozeUntil?: number,
  ) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="thread-row-wrapper">
      <button
        type="button"
        className={`thread-row ${isSelected ? "selected" : ""}`}
        onClick={onSelect}
        onContextMenu={(e: MouseEvent) => {
          e.preventDefault();
          setMenuOpen(true);
        }}
      >
        <div className="thread-row-left">
          {thread.hasUnread && <span className="unread-dot" />}
          <div className="thread-row-text">
            {showBranch && thread.branch && (
              <span className="thread-branch-badge">{thread.branch}</span>
            )}
            <span className="thread-title">{thread.title}</span>
            {thread.lastOutputPreview && (
              <span className="thread-preview">{thread.lastOutputPreview}</span>
            )}
          </div>
        </div>
        <div className="thread-row-right">
          {thread.ptyRunning && (
            <span className="pty-indicator" title="Terminal running" />
          )}
          <span className="thread-time">
            {formatRelativeTime(thread.lastActivityAt)}
          </span>
          <span className={`thread-status-icon status-${thread.status}`}>
            {STATUS_ICONS[thread.status]}
          </span>
        </div>
      </button>
      <DropdownMenu.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenu.Trigger className="thread-row-menu-anchor" />
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="dropdown-content" sideOffset={4}>
            <DropdownMenu.Item
              className="dropdown-item"
              onSelect={() => onContextAction(thread.id, "active")}
            >
              {"\u25B6"} Mark Active
            </DropdownMenu.Item>
            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger className="dropdown-item dropdown-sub-trigger">
                {"\u23F8"} Snooze...
                <span className="dropdown-sub-arrow">&rsaquo;</span>
              </DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent
                  className="dropdown-content"
                  sideOffset={4}
                >
                  {SNOOZE_OPTIONS.map((opt) => (
                    <DropdownMenu.Item
                      key={opt.label}
                      className="dropdown-item"
                      onSelect={() =>
                        onContextAction(thread.id, "snooze", opt.getTimestamp())
                      }
                    >
                      {opt.label}
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>
            <DropdownMenu.Item
              className="dropdown-item"
              onSelect={() => onContextAction(thread.id, "done")}
            >
              {"\u2713"} Mark as Done
            </DropdownMenu.Item>
            {showBranch && (
              <>
                <DropdownMenu.Separator className="dropdown-separator" />
                {thread.branch ? (
                  <>
                    <DropdownMenu.Item
                      className="dropdown-item"
                      onSelect={() => onContextAction(thread.id, "copy-branch")}
                    >
                      Copy branch name
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      className="dropdown-item"
                      onSelect={() =>
                        onContextAction(thread.id, "detach-branch")
                      }
                    >
                      Detach branch
                    </DropdownMenu.Item>
                  </>
                ) : (
                  <DropdownMenu.Item
                    className="dropdown-item"
                    onSelect={() => onContextAction(thread.id, "attach-branch")}
                  >
                    Attach branch...
                  </DropdownMenu.Item>
                )}
              </>
            )}
            <DropdownMenu.Separator className="dropdown-separator" />
            <DropdownMenu.Item
              className="dropdown-item dropdown-item-danger"
              onSelect={() => onContextAction(thread.id, "kill")}
            >
              Kill Terminal
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}

function ThreadGroup({
  title,
  threads,
  selectedThreadId,
  showBranch,
  onSelectThread,
  onContextAction,
  defaultCollapsed,
}: {
  title: string;
  threads: Thread[];
  selectedThreadId: string | null;
  showBranch: boolean;
  onSelectThread: (id: string) => void;
  onContextAction: (
    threadId: string,
    action: string,
    snoozeUntil?: number,
  ) => void;
  defaultCollapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed ?? false);

  if (threads.length === 0) return null;

  return (
    <div className="thread-group">
      <button
        type="button"
        className="thread-group-header"
        onClick={() => setCollapsed(!collapsed)}
      >
        <span className={`group-chevron ${collapsed ? "" : "expanded"}`}>
          &rsaquo;
        </span>
        <span className="group-title">{title}</span>
        <span className="group-count">{threads.length}</span>
      </button>
      {!collapsed && (
        <div className="thread-group-list">
          {threads.map((thread) => (
            <ThreadRow
              key={thread.id}
              thread={thread}
              isSelected={thread.id === selectedThreadId}
              showBranch={showBranch}
              onSelect={() => onSelectThread(thread.id)}
              onContextAction={onContextAction}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BranchPicker({
  rootPath,
  onSelect,
  onClose,
}: {
  rootPath: string;
  onSelect: (branch: string, autoCreated: boolean) => void;
  onClose: () => void;
}) {
  const [branches, setBranches] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newBranch, setNewBranch] = useState("");
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    invoke<string[]>("git_list_branches", { path: rootPath })
      .then((b) => {
        setBranches(b);
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });
  }, [rootPath]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleCreateBranch = useCallback(async () => {
    const name = newBranch.trim();
    if (!name) return;
    setCreating(true);
    try {
      const exists = await invoke<boolean>("git_branch_exists", {
        path: rootPath,
        branch: name,
      });
      if (exists) {
        onSelect(name, false);
      } else {
        await invoke("git_create_branch", { path: rootPath, branch: name });
        onSelect(name, true);
      }
    } catch (e) {
      setError(String(e));
      setCreating(false);
    }
  }, [newBranch, rootPath, onSelect]);

  return (
    <div className="branch-picker">
      <div className="branch-picker-header">
        <span className="branch-picker-title">Attach branch</span>
        <button type="button" className="branch-picker-close" onClick={onClose}>
          &times;
        </button>
      </div>
      <div className="branch-picker-create">
        <input
          ref={inputRef}
          className="branch-picker-input"
          type="text"
          placeholder="New branch name..."
          value={newBranch}
          onChange={(e) => setNewBranch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleCreateBranch();
            }
            if (e.key === "Escape") onClose();
          }}
          disabled={creating}
        />
        <button
          type="button"
          className="branch-picker-create-btn"
          disabled={!newBranch.trim() || creating}
          onClick={handleCreateBranch}
        >
          {creating ? "..." : "+"}
        </button>
      </div>
      {error && <div className="branch-picker-error">{error}</div>}
      <div className="branch-picker-list">
        {loading ? (
          <div className="branch-picker-empty">Loading...</div>
        ) : branches.length === 0 ? (
          <div className="branch-picker-empty">No branches found</div>
        ) : (
          branches.map((b) => (
            <button
              key={b}
              type="button"
              className="branch-picker-item"
              onClick={() => onSelect(b, false)}
            >
              {b}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

export default function ThreadList() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [prompt, setPrompt] = useState("");
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [selectedBranchAutoCreated, setSelectedBranchAutoCreated] =
    useState(false);
  // Track which thread to show the attach-branch picker for (context menu)
  const [attachPickerThreadId, setAttachPickerThreadId] = useState<
    string | null
  >(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const gitEnabled = state.gitStatus?.gitInstalled && state.gitStatus?.isRepo;

  const channelThreads = state.threads.filter(
    (t) => t.channelId === state.selectedChannelId,
  );

  const active = channelThreads.filter((t) => t.status === "active");
  const snoozed = channelThreads.filter((t) => t.status === "snoozed");
  const done = channelThreads.filter((t) => t.status === "done");

  // Flat ordered list for keyboard nav (active, snoozed, done)
  const flatThreads = [...active, ...snoozed, ...done];

  function findChannelName(
    channels: typeof state.channels,
    id: string | null,
  ): string {
    for (const ch of channels) {
      if (ch.id === id) return ch.name;
      const found = findChannelName(ch.children, id);
      if (found) return found;
    }
    return "";
  }
  const channelName = findChannelName(state.channels, state.selectedChannelId);

  const handleSelectThread = useCallback(
    (threadId: string) => {
      dispatch({ type: "SELECT_THREAD", threadId });
    },
    [dispatch],
  );

  const handleSendPrompt = useCallback(() => {
    if (!state.selectedChannelId) return;
    const text = prompt.trim();
    if (!text) return;
    threadCounter++;
    const id = `thread-${Date.now()}-${threadCounter}`;
    dispatch({
      type: "CREATE_THREAD",
      id,
      channelId: state.selectedChannelId,
      title: text,
      ptyId: 0,
      branch: selectedBranch,
      branchAutoCreated: selectedBranchAutoCreated,
    });
    setPrompt("");
    setSelectedBranch(null);
    setSelectedBranchAutoCreated(false);
    setBranchPickerOpen(false);
  }, [
    state.selectedChannelId,
    prompt,
    selectedBranch,
    selectedBranchAutoCreated,
    dispatch,
  ]);

  const handleContextAction = useCallback(
    (threadId: string, action: string, snoozeUntil?: number) => {
      switch (action) {
        case "active":
          dispatch({
            type: "SET_THREAD_STATUS",
            threadId,
            status: "active",
          });
          break;
        case "done":
          dispatch({
            type: "SET_THREAD_STATUS",
            threadId,
            status: "done",
          });
          break;
        case "snooze":
          dispatch({
            type: "SET_THREAD_STATUS",
            threadId,
            status: "snoozed",
            snoozeUntil,
          });
          break;
        case "kill":
          dispatch({ type: "KILL_THREAD_PTY", threadId });
          break;
        case "detach-branch":
          dispatch({ type: "DETACH_BRANCH", threadId });
          break;
        case "copy-branch": {
          const thread = state.threads.find((t) => t.id === threadId);
          if (thread?.branch) {
            navigator.clipboard.writeText(thread.branch);
          }
          break;
        }
        case "attach-branch":
          setAttachPickerThreadId(threadId);
          break;
      }
    },
    [dispatch, state.threads],
  );

  // Keyboard shortcuts
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+N: focus the compose input
      if (e.metaKey && e.key === "n") {
        e.preventDefault();
        inputRef.current?.focus();
        return;
      }

      // Cmd+D: mark done
      if (e.metaKey && e.key === "d" && state.selectedThreadId) {
        e.preventDefault();
        dispatch({
          type: "SET_THREAD_STATUS",
          threadId: state.selectedThreadId,
          status: "done",
        });
        return;
      }

      if (flatThreads.length === 0) return;

      // Arrow navigation
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const currentIdx = flatThreads.findIndex(
          (t) => t.id === state.selectedThreadId,
        );
        let nextIdx: number;
        if (e.key === "ArrowDown") {
          nextIdx =
            currentIdx < 0
              ? 0
              : Math.min(currentIdx + 1, flatThreads.length - 1);
        } else {
          nextIdx =
            currentIdx < 0
              ? flatThreads.length - 1
              : Math.max(currentIdx - 1, 0);
        }
        dispatch({ type: "SELECT_THREAD", threadId: flatThreads[nextIdx].id });
        return;
      }

      // Enter: select thread (focus terminal)
      if (e.key === "Enter" && state.selectedThreadId) {
        e.preventDefault();
        dispatch({
          type: "SELECT_THREAD",
          threadId: state.selectedThreadId,
        });
      }
    };

    el.addEventListener("keydown", handleKeyDown);
    return () => el.removeEventListener("keydown", handleKeyDown);
  }, [state.selectedThreadId, flatThreads, dispatch]);

  if (!state.selectedChannelId) {
    return (
      <div className="thread-list">
        <div className="thread-list-empty">
          <p>Select a folder to view threads</p>
        </div>
      </div>
    );
  }

  return (
    <div className="thread-list" ref={listRef} tabIndex={0}>
      <div className="thread-list-header">
        <span className="thread-list-channel-name">{channelName}</span>
      </div>

      <div className="thread-list-body">
        <ThreadGroup
          title="Active"
          threads={active}
          selectedThreadId={state.selectedThreadId}
          showBranch={!!gitEnabled}
          onSelectThread={handleSelectThread}
          onContextAction={handleContextAction}
        />
        <ThreadGroup
          title="Snoozed"
          threads={snoozed}
          selectedThreadId={state.selectedThreadId}
          showBranch={!!gitEnabled}
          onSelectThread={handleSelectThread}
          onContextAction={handleContextAction}
        />
        <ThreadGroup
          title="Done"
          threads={done}
          selectedThreadId={state.selectedThreadId}
          showBranch={!!gitEnabled}
          onSelectThread={handleSelectThread}
          onContextAction={handleContextAction}
          defaultCollapsed
        />
        {channelThreads.length === 0 && (
          <div className="thread-list-empty-body">
            <p>No threads yet — type a prompt below</p>
          </div>
        )}
      </div>

      {/* Attach-branch picker triggered from context menu */}
      {attachPickerThreadId && state.rootPath && (
        <BranchPicker
          rootPath={state.rootPath}
          onSelect={(branch, autoCreated) => {
            dispatch({
              type: "ATTACH_BRANCH",
              threadId: attachPickerThreadId,
              branch,
              autoCreated,
            });
            setAttachPickerThreadId(null);
          }}
          onClose={() => setAttachPickerThreadId(null)}
        />
      )}

      <div className="compose-area">
        {gitEnabled && (
          <div className="compose-branch-row">
            {selectedBranch ? (
              <span className="compose-branch-selected">
                <span className="compose-branch-name">{selectedBranch}</span>
                <button
                  type="button"
                  className="compose-branch-clear"
                  onClick={() => {
                    setSelectedBranch(null);
                    setSelectedBranchAutoCreated(false);
                  }}
                >
                  &times;
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="compose-branch-toggle"
                onClick={() => setBranchPickerOpen(!branchPickerOpen)}
              >
                {branchPickerOpen ? "Hide branches" : "Branch..."}
              </button>
            )}
          </div>
        )}
        {branchPickerOpen && !selectedBranch && state.rootPath && (
          <BranchPicker
            rootPath={state.rootPath}
            onSelect={(branch, autoCreated) => {
              setSelectedBranch(branch);
              setSelectedBranchAutoCreated(autoCreated);
              setBranchPickerOpen(false);
            }}
            onClose={() => setBranchPickerOpen(false)}
          />
        )}
        <form
          className="compose-bar"
          onSubmit={(e) => {
            e.preventDefault();
            handleSendPrompt();
          }}
        >
          <input
            ref={inputRef}
            className="compose-input"
            type="text"
            placeholder="New thread..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <button
            type="submit"
            className="compose-send"
            disabled={!prompt.trim()}
          >
            &uarr;
          </button>
        </form>
      </div>
    </div>
  );
}
