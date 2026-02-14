import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useMemo, useState } from "react";
import { useAppDispatch, useAppState } from "../store";
import type { Channel, Thread } from "../types";

interface DirEntry {
  name: string;
  path: string;
  children: DirEntry[];
}

function buildChannelTree(entry: DirEntry): Channel {
  return {
    id: entry.path,
    name: entry.name,
    path: entry.path,
    children: entry.children.map(buildChannelTree),
  };
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getReplyReason(
  thread: Thread,
): { text: string; className: string } | null {
  if (thread.snoozeDue) {
    return { text: "Snooze expired", className: "reply-reason-snooze" };
  }
  if (thread.hasUnread) {
    return { text: "New activity", className: "reply-reason-unread" };
  }
  return null;
}

function ChannelNode({
  channel,
  depth,
  selectedChannelId,
  threadCounts,
  onSelect,
}: {
  channel: Channel;
  depth: number;
  selectedChannelId: string | null;
  threadCounts: Map<string, number>;
  onSelect: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = channel.children.length > 0;
  const count = threadCounts.get(channel.id) ?? 0;
  const isSelected = channel.id === selectedChannelId;

  return (
    <div className="channel-node">
      <button
        type="button"
        className={`channel-row ${isSelected ? "selected" : ""}`}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        onClick={() => onSelect(channel.id)}
      >
        {hasChildren ? (
          <span
            className={`channel-chevron ${expanded ? "expanded" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            onKeyDown={() => {}}
            role="button"
            tabIndex={-1}
          >
            &rsaquo;
          </span>
        ) : (
          <span className="channel-chevron-spacer" />
        )}
        <span className="channel-icon">&#128193;</span>
        <span className="channel-name">{channel.name}</span>
        {count > 0 && <span className="channel-badge">{count}</span>}
      </button>
      {hasChildren && expanded && (
        <div className="channel-children">
          {channel.children.map((child) => (
            <ChannelNode
              key={child.id}
              channel={child}
              depth={depth + 1}
              selectedChannelId={selectedChannelId}
              threadCounts={threadCounts}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function Sidebar() {
  const state = useAppState();
  const dispatch = useAppDispatch();

  const threadCounts = new Map<string, number>();
  for (const thread of state.threads) {
    threadCounts.set(
      thread.channelId,
      (threadCounts.get(thread.channelId) ?? 0) + 1,
    );
  }

  // Replies: unread + snooze-due, sorted most recently active first
  const replyThreads = useMemo(() => {
    return state.threads
      .filter((t) => t.hasUnread || t.snoozeDue)
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  }, [state.threads]);

  // Build channel name lookup
  const channelNameMap = useMemo(() => {
    const map = new Map<string, string>();
    function walk(channels: Channel[]) {
      for (const ch of channels) {
        map.set(ch.id, ch.name);
        walk(ch.children);
      }
    }
    walk(state.channels);
    return map;
  }, [state.channels]);

  const handlePickFolder = useCallback(async () => {
    const selected = await open({
      directory: true,
      recursive: true,
      title: "Select a project folder",
    });
    if (!selected) return;

    const tree = await invoke<DirEntry>("scan_directory", { root: selected });
    const root = buildChannelTree(tree);
    dispatch({
      type: "SET_CHANNELS",
      channels: [root],
      rootPath: selected,
    });
    dispatch({ type: "SELECT_CHANNEL", channelId: root.id });

    // Detect git availability for branch features
    try {
      const status = await invoke<{
        git_installed: boolean;
        is_repo: boolean;
        user_configured: boolean;
      }>("git_status", { path: selected });
      dispatch({
        type: "SET_GIT_STATUS",
        gitStatus: {
          gitInstalled: status.git_installed,
          isRepo: status.is_repo,
          userConfigured: status.user_configured,
        },
      });
    } catch {
      dispatch({
        type: "SET_GIT_STATUS",
        gitStatus: {
          gitInstalled: false,
          isRepo: false,
          userConfigured: false,
        },
      });
    }
  }, [dispatch]);

  const handleSelectChannel = useCallback(
    (channelId: string) => {
      dispatch({ type: "SELECT_CHANNEL", channelId });
    },
    [dispatch],
  );

  const handleSelectReply = useCallback(
    (threadId: string, channelId: string) => {
      dispatch({ type: "SELECT_CHANNEL", channelId });
      dispatch({ type: "SELECT_THREAD", threadId });
    },
    [dispatch],
  );

  const handleMarkAllRead = useCallback(() => {
    dispatch({ type: "MARK_ALL_READ" });
  }, [dispatch]);

  return (
    <div className="sidebar">
      <div className="sidebar-drag-region" data-tauri-drag-region="" />

      <div className="sidebar-header">
        {state.rootPath ? (
          <>
            <span className="sidebar-title">
              {state.rootPath.split("/").pop()}
            </span>
            <button
              type="button"
              className="sidebar-change-btn"
              onClick={handlePickFolder}
            >
              Change
            </button>
          </>
        ) : (
          <button
            type="button"
            className="sidebar-pick-btn"
            onClick={handlePickFolder}
          >
            Select a project folder
          </button>
        )}
      </div>

      <div className="sidebar-tree">
        {state.channels.map((channel) => (
          <ChannelNode
            key={channel.id}
            channel={channel}
            depth={0}
            selectedChannelId={state.selectedChannelId}
            threadCounts={threadCounts}
            onSelect={handleSelectChannel}
          />
        ))}
      </div>

      {/* Replies section */}
      <div className="sidebar-replies">
        <div className="sidebar-replies-header">
          <span>Replies</span>
          {replyThreads.length > 0 && (
            <span className="replies-badge">{replyThreads.length}</span>
          )}
          <span className="replies-header-spacer" />
          {replyThreads.length > 0 && (
            <button
              type="button"
              className="replies-mark-all-btn"
              onClick={handleMarkAllRead}
            >
              Mark all read
            </button>
          )}
        </div>
        <div className="sidebar-replies-list">
          {replyThreads.length === 0 ? (
            <div className="replies-empty">
              <span className="replies-empty-icon">{"\u2713"}</span>
              <span>All caught up</span>
            </div>
          ) : (
            replyThreads.map((thread) => {
              const reason = getReplyReason(thread);
              return (
                <button
                  key={thread.id}
                  type="button"
                  className="reply-row"
                  onClick={() => handleSelectReply(thread.id, thread.channelId)}
                >
                  <div className="reply-row-top">
                    <span className="reply-channel">
                      {channelNameMap.get(thread.channelId) ?? "unknown"}
                    </span>
                    {reason && (
                      <span className={`reply-reason ${reason.className}`}>
                        {reason.text}
                      </span>
                    )}
                  </div>
                  <span className="reply-title">{thread.title}</span>
                  {state.gitStatus?.isRepo && thread.branch && (
                    <span className="reply-branch">{thread.branch}</span>
                  )}
                  {thread.lastOutputPreview && (
                    <span className="reply-preview">
                      {thread.lastOutputPreview}
                    </span>
                  )}
                  <span className="reply-time">
                    {formatRelativeTime(thread.lastActivityAt)}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
