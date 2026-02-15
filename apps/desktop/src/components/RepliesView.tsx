import { useCallback, useMemo } from "react";
import { useAppState, useAppDispatch } from "../store";
import type { Channel, Thread } from "../types";

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

export default function RepliesView() {
  const state = useAppState();
  const dispatch = useAppDispatch();

  const replyThreads = useMemo(() => {
    return state.threads
      .filter((t) => t.hasUnread || t.snoozeDue)
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  }, [state.threads]);

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
    <div className="thread-list">
      <div className="thread-list-header">
        <span className="thread-list-channel-name">Replies</span>
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

      <div className="thread-list-body">
        {replyThreads.length === 0 ? (
          <div className="thread-list-empty-body">
            <p>All caught up</p>
          </div>
        ) : (
          <div className="thread-group-list">
            {replyThreads.map((thread) => {
              const reason = getReplyReason(thread);
              return (
                <button
                  key={thread.id}
                  type="button"
                  className={`thread-row ${thread.id === state.selectedThreadId ? "selected" : ""}`}
                  onClick={() =>
                    handleSelectReply(thread.id, thread.channelId)
                  }
                >
                  <div className="thread-row-left">
                    {reason && (
                      <span
                        className={`unread-dot ${thread.snoozeDue ? "snooze-due" : ""}`}
                      />
                    )}
                    <div className="thread-row-text">
                      <span className="thread-title">{thread.title}</span>
                      <span className="thread-preview">
                        {channelNameMap.get(thread.channelId) ?? "unknown"}
                        {reason && ` \u00B7 ${reason.text}`}
                      </span>
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
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
