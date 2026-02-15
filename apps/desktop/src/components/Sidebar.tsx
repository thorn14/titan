import { useState, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useAppState, useAppDispatch } from "../store";
import type { Channel } from "../types";

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
    if (thread.status === "done") continue;
    threadCounts.set(
      thread.channelId,
      (threadCounts.get(thread.channelId) ?? 0) + 1,
    );
  }

  const replyCount = useMemo(() => {
    return state.threads.filter((t) => t.hasUnread || t.snoozeDue).length;
  }, [state.threads]);

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
  }, [dispatch]);

  const handleSelectChannel = useCallback(
    (channelId: string) => {
      dispatch({ type: "SELECT_CHANNEL", channelId });
    },
    [dispatch],
  );

  const handleOpenReplies = useCallback(() => {
    dispatch({ type: "SET_VIEW", view: "replies" });
  }, [dispatch]);

  const handleToggleTheme = useCallback(() => {
    dispatch({ type: "TOGGLE_THEME" });
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

      {/* Replies button */}
      <div className="sidebar-bottom">
        <button
          type="button"
          className={`replies-btn ${state.currentView === "replies" ? "active" : ""}`}
          onClick={handleOpenReplies}
        >
          <span className="replies-btn-icon">{"\u21A9"}</span>
          <span>Replies</span>
          {replyCount > 0 && (
            <span className="replies-badge">{replyCount}</span>
          )}
        </button>

        <button
          type="button"
          className={`theme-toggle-btn ${state.currentView === "settings" ? "active" : ""}`}
          onClick={() => dispatch({ type: "SET_VIEW", view: "settings" })}
          title="Settings"
        >
          {"\u2699"}
        </button>

        <button
          type="button"
          className="theme-toggle-btn"
          onClick={handleToggleTheme}
          title={`Switch to ${state.theme === "dark" ? "light" : "dark"} mode`}
        >
          {state.theme === "dark" ? "\u2600" : "\u263D"}
        </button>
      </div>
    </div>
  );
}
