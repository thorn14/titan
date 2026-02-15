import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  type MouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { SNOOZE_OPTIONS } from "../snooze";
import { useAppDispatch, useAppState } from "../store";
import type { Thread, ThreadStatus, ThreadType } from "../types";
import ProviderSettings from "./ProviderSettings";

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
  inactive: "\u23F9",
};

const THREAD_TYPE_ICONS: Record<ThreadType, string> = {
  terminal: "\u25A0",
  chat: "\u25C6",
};

function InlineRenameTitle({
  thread,
  onRename,
  editRequested,
  onEditStarted,
}: {
  thread: Thread;
  onRename: (threadId: string, title: string) => void;
  editRequested?: boolean;
  onEditStarted?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(thread.title);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  useEffect(() => {
    if (editRequested) {
      setValue(thread.title);
      setEditing(true);
      onEditStarted?.();
    }
  }, [editRequested, thread.title, onEditStarted]);

  if (!editing) {
    return (
      <span
        className="thread-title"
        onDoubleClick={(e) => {
          e.stopPropagation();
          setValue(thread.title);
          setEditing(true);
        }}
      >
        <span className="thread-type-icon" title={thread.threadType}>
          {THREAD_TYPE_ICONS[thread.threadType]}
        </span>
        {thread.title}
      </span>
    );
  }

  return (
    <input
      ref={inputRef}
      className="thread-title-edit"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          const trimmed = value.trim();
          if (trimmed && trimmed !== thread.title) {
            onRename(thread.id, trimmed);
          }
          setEditing(false);
        }
        if (e.key === "Escape") {
          cancelledRef.current = true;
          setEditing(false);
        }
      }}
      onBlur={() => {
        if (cancelledRef.current) {
          cancelledRef.current = false;
          return;
        }
        const trimmed = value.trim();
        if (trimmed && trimmed !== thread.title) {
          onRename(thread.id, trimmed);
        }
        setEditing(false);
      }}
    />
  );
}

function ThreadRow({
  thread,
  isSelected,
  onSelect,
  onContextAction,
  onRename,
}: {
  thread: Thread;
  isSelected: boolean;
  onSelect: () => void;
  onContextAction: (
    threadId: string,
    action: string,
    snoozeUntil?: number,
  ) => void;
  onRename: (threadId: string, title: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renameRequested, setRenameRequested] = useState(false);

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
            <InlineRenameTitle
              thread={thread}
              onRename={onRename}
              editRequested={renameRequested}
              onEditStarted={() => setRenameRequested(false)}
            />
            {thread.lastOutputPreview && (
              <span className="thread-preview">{thread.lastOutputPreview}</span>
            )}
          </div>
        </div>
        <div className="thread-row-right">
          {thread.threadType === "terminal" && thread.ptyRunning && (
            <span className="pty-indicator" title="Terminal running" />
          )}
          {thread.threadType === "chat" && thread.isStreaming && (
            <span className="pty-indicator" title="Streaming" />
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
              onSelect={() => setRenameRequested(true)}
            >
              Rename...
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="dropdown-separator" />
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
            <DropdownMenu.Separator className="dropdown-separator" />
            {thread.threadType === "terminal" && (
              <DropdownMenu.Item
                className="dropdown-item dropdown-item-danger"
                onSelect={() => onContextAction(thread.id, "kill")}
              >
                Kill Terminal
              </DropdownMenu.Item>
            )}
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
  onRename,
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
  onRename: (threadId: string, title: string) => void;
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
              onRename={onRename}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ScheduleDropdown({
  onSchedule,
}: {
  onSchedule: (timestamp: number) => void;
}) {
  const [showCustom, setShowCustom] = useState(false);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="compose-schedule" title="Schedule send">
          {"\u23F0"}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="dropdown-content" sideOffset={4} align="end">
          {SNOOZE_OPTIONS.map((opt) => (
            <DropdownMenu.Item
              key={opt.label}
              className="dropdown-item"
              onSelect={() => onSchedule(opt.getTimestamp())}
            >
              {opt.label}
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator className="dropdown-separator" />
          <DropdownMenu.Item
            className="dropdown-item"
            onSelect={(e) => {
              e.preventDefault();
              setShowCustom(true);
            }}
          >
            Custom time...
          </DropdownMenu.Item>
          {showCustom && (
            <div className="schedule-custom" onClick={(e) => e.stopPropagation()}>
              <input
                type="datetime-local"
                className="schedule-custom-input"
                onChange={(e) => {
                  const ts = new Date(e.target.value).getTime();
                  if (ts > Date.now()) {
                    onSchedule(ts);
                    setShowCustom(false);
                  }
                }}
              />
            </div>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export default function ThreadList() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [prompt, setPrompt] = useState("");
  const [threadType, setThreadType] = useState<ThreadType>("terminal");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const channelThreads = state.threads.filter(
    (t) => t.channelId === state.selectedChannelId,
  );

  const active = channelThreads.filter((t) => t.status === "active");
  const snoozed = channelThreads.filter((t) => t.status === "snoozed");
  const inactive = channelThreads.filter((t) => t.status === "inactive");
  const done = channelThreads.filter((t) => t.status === "done");

  // Flat ordered list for keyboard nav
  const flatThreads = [...active, ...snoozed, ...inactive, ...done];

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

  // Pending scheduled messages for this channel
  const pendingScheduled = state.scheduledMessages.filter(
    (m) => m.channelId === state.selectedChannelId,
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
    // Allow empty prompt — creates thread with placeholder name
    threadCounter++;
    const id = `thread-${Date.now()}-${threadCounter}`;

    if (threadType === "chat") {
      const defaultProvider = state.providers.find(
        (p) => p.id === state.defaultProviderId,
      );
      if (!defaultProvider) {
        setSettingsOpen(true);
        return;
      }
      dispatch({
        type: "CREATE_CHAT_THREAD",
        id,
        channelId: state.selectedChannelId,
        title: text || "New chat",
        providerId: defaultProvider.id,
        model: defaultProvider.defaultModel,
      });
    } else {
      dispatch({
        type: "CREATE_THREAD",
        id,
        channelId: state.selectedChannelId,
        title: text || "New thread",
        ptyId: 0,
      });
    }
    setPrompt("");
  }, [
    state.selectedChannelId,
    state.providers,
    state.defaultProviderId,
    prompt,
    threadType,
    dispatch,
  ]);

  const handleScheduleSend = useCallback(
    (timestamp: number) => {
      if (!state.selectedChannelId) return;
      const text = prompt.trim();
      if (!text) return;
      const id = `sched-${Date.now()}-${threadCounter++}`;
      dispatch({
        type: "SCHEDULE_MESSAGE",
        message: {
          id,
          channelId: state.selectedChannelId,
          prompt: text,
          scheduledAt: timestamp,
        },
      });
      setPrompt("");
    },
    [state.selectedChannelId, prompt, dispatch],
  );

  const handleRename = useCallback(
    (threadId: string, title: string) => {
      dispatch({ type: "RENAME_THREAD", threadId, title });
    },
    [dispatch],
  );

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
        <button
          type="button"
          className="thread-list-settings-btn"
          onClick={() => setSettingsOpen(true)}
          title="LLM Provider Settings"
        >
          &equiv;
        </button>
      </div>

      <div className="thread-list-body">
        <ThreadGroup
          title="Active"
          threads={active}
          selectedThreadId={state.selectedThreadId}
          onSelectThread={handleSelectThread}
          onContextAction={handleContextAction}
          onRename={handleRename}
        />
        <ThreadGroup
          title="Snoozed"
          threads={snoozed}
          selectedThreadId={state.selectedThreadId}
          onSelectThread={handleSelectThread}
          onContextAction={handleContextAction}
          onRename={handleRename}
        />
        <ThreadGroup
          title="Inactive"
          threads={inactive}
          selectedThreadId={state.selectedThreadId}
          onSelectThread={handleSelectThread}
          onContextAction={handleContextAction}
          onRename={handleRename}
          defaultCollapsed
        />
        <ThreadGroup
          title="Done"
          threads={done}
          selectedThreadId={state.selectedThreadId}
          onSelectThread={handleSelectThread}
          onContextAction={handleContextAction}
          onRename={handleRename}
          defaultCollapsed
        />
        {channelThreads.length === 0 && (
          <div className="thread-list-empty-body">
            <p>No threads yet — type a prompt or press Enter</p>
          </div>
        )}
      </div>

      {/* Scheduled messages indicator */}
      {pendingScheduled.length > 0 && (
        <div className="scheduled-list">
          {pendingScheduled.map((m) => (
            <div key={m.id} className="scheduled-item">
              <span className="scheduled-icon">{"\u23F0"}</span>
              <span className="scheduled-text">{m.prompt}</span>
              <span className="scheduled-time">
                {new Date(m.scheduledAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
              <button
                type="button"
                className="scheduled-cancel"
                onClick={() =>
                  dispatch({ type: "CANCEL_SCHEDULED", messageId: m.id })
                }
              >
                {"\u2715"}
              </button>
            </div>
          ))}
        </div>
      )}

      <form
        className="compose-bar"
        onSubmit={(e) => {
          e.preventDefault();
          handleSendPrompt();
        }}
      >
        <div className="compose-type-toggle">
          <button
            type="button"
            className={`compose-type-btn ${threadType === "terminal" ? "active" : ""}`}
            onClick={() => setThreadType("terminal")}
            title="Terminal thread"
          >
            {THREAD_TYPE_ICONS.terminal}
          </button>
          <button
            type="button"
            className={`compose-type-btn ${threadType === "chat" ? "active" : ""}`}
            onClick={() => setThreadType("chat")}
            title="Chat thread"
          >
            {THREAD_TYPE_ICONS.chat}
          </button>
        </div>
        <input
          ref={inputRef}
          className="compose-input"
          type="text"
          placeholder={threadType === "chat" ? "New chat..." : "New thread... (Enter to start)"}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <ScheduleDropdown onSchedule={handleScheduleSend} />
        <button
          type="submit"
          className="compose-send"
        >
          &uarr;
        </button>
      </form>

      <ProviderSettings open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
