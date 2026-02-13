import { useState, useCallback, useRef, useEffect, type MouseEvent } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useAppState, useAppDispatch } from "../store";
import { SNOOZE_OPTIONS } from "../snooze";
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
  onSelect,
  onContextAction,
}: {
  thread: Thread;
  isSelected: boolean;
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
            <span className="thread-title">{thread.title}</span>
            {thread.lastOutputPreview && (
              <span className="thread-preview">
                {thread.lastOutputPreview}
              </span>
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
                      onContextAction(
                        thread.id,
                        "snooze",
                        opt.getTimestamp(),
                      )
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
  onSelectThread,
  onContextAction,
  defaultCollapsed,
}: {
  title: string;
  threads: Thread[];
  selectedThreadId: string | null;
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
              onSelect={() => onSelectThread(thread.id)}
              onContextAction={onContextAction}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ThreadList() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [prompt, setPrompt] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

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
  const channelName = findChannelName(
    state.channels,
    state.selectedChannelId,
  );

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
    });
    setPrompt("");
  }, [state.selectedChannelId, prompt, dispatch]);

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
      }
    },
    [dispatch],
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
            currentIdx < 0 ? 0 : Math.min(currentIdx + 1, flatThreads.length - 1);
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
          onSelectThread={handleSelectThread}
          onContextAction={handleContextAction}
        />
        <ThreadGroup
          title="Snoozed"
          threads={snoozed}
          selectedThreadId={state.selectedThreadId}
          onSelectThread={handleSelectThread}
          onContextAction={handleContextAction}
        />
        <ThreadGroup
          title="Done"
          threads={done}
          selectedThreadId={state.selectedThreadId}
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
  );
}
