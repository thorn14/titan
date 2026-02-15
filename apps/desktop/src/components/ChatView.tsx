import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { streamChatResponse } from "../providers";
import { SNOOZE_OPTIONS, type SnoozeOption } from "../snooze";
import { useAppDispatch, useAppState } from "../store";
import type { ChatMessage, Thread, ThreadStatus } from "../types";

const STATUS_LABELS: Record<ThreadStatus, string> = {
  active: "\u25B6 Active",
  snoozed: "\u23F8 Snoozed",
  done: "\u2713 Done",
  inactive: "\u23F9 Inactive",
};

function ChatToolbar({ thread }: { thread: Thread }) {
  const state = useAppState();
  const dispatch = useAppDispatch();

  const provider = state.providers.find((p) => p.id === thread.providerId);
  const modelLabel = thread.model ?? provider?.defaultModel ?? "unknown";

  const handleStatusChange = (status: ThreadStatus) => {
    dispatch({
      type: "SET_THREAD_STATUS",
      threadId: thread.id,
      status,
    });
  };

  const handleSnooze = (option: SnoozeOption) => {
    dispatch({
      type: "SET_THREAD_STATUS",
      threadId: thread.id,
      status: "snoozed",
      snoozeUntil: option.getTimestamp(),
    });
  };

  return (
    <div className="thread-toolbar">
      <div className="thread-toolbar-left">
        <span
          className={`pty-status-dot ${thread.isStreaming ? "running" : "exited"}`}
        />
        <span className="thread-toolbar-title">{thread.title}</span>
        <span className="chat-model-label">{modelLabel}</span>
      </div>
      <div className="thread-toolbar-actions">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button type="button" className="status-dropdown-trigger">
              {STATUS_LABELS[thread.status]}
              <span className="dropdown-caret">&darr;</span>
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="dropdown-content"
              sideOffset={4}
              align="end"
            >
              <DropdownMenu.Item
                className={`dropdown-item ${thread.status === "active" ? "active" : ""}`}
                onSelect={() => handleStatusChange("active")}
              >
                {STATUS_LABELS.active}
              </DropdownMenu.Item>

              <DropdownMenu.Sub>
                <DropdownMenu.SubTrigger
                  className={`dropdown-item dropdown-sub-trigger ${thread.status === "snoozed" ? "active" : ""}`}
                >
                  {STATUS_LABELS.snoozed}
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
                        onSelect={() => handleSnooze(opt)}
                      >
                        {opt.label}
                      </DropdownMenu.Item>
                    ))}
                  </DropdownMenu.SubContent>
                </DropdownMenu.Portal>
              </DropdownMenu.Sub>

              <DropdownMenu.Item
                className={`dropdown-item ${thread.status === "done" ? "active" : ""}`}
                onSelect={() => handleStatusChange("done")}
              >
                {STATUS_LABELS.done}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  return (
    <div
      className={`chat-message ${isUser ? "chat-message-user" : "chat-message-assistant"}`}
    >
      <div className="chat-message-role">{isUser ? "You" : "Assistant"}</div>
      <div className="chat-message-content">
        {isUser ? (
          <p>{message.content}</p>
        ) : (
          <Markdown remarkPlugins={[remarkGfm]}>{message.content}</Markdown>
        )}
      </div>
    </div>
  );
}

export default function ChatView() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const selectedThread = state.threads.find(
    (t) => t.id === state.selectedThreadId,
  );

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Scroll to bottom when messages change
  const messageCount = selectedThread?.chatMessages.length ?? 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: messageCount triggers scroll on new messages
  useEffect(() => {
    scrollToBottom();
  }, [messageCount, scrollToBottom]);

  // Auto-resize textarea
  // biome-ignore lint/correctness/useExhaustiveDependencies: input triggers textarea resize
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 150)}px`;
    }
  }, [input]);

  const handleSubmit = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault();
      if (!selectedThread || !input.trim() || selectedThread.isStreaming)
        return;

      const provider = state.providers.find(
        (p) => p.id === selectedThread.providerId,
      );
      if (!provider) return;

      const userMessage: ChatMessage = {
        id: `msg-${Date.now()}-user`,
        role: "user",
        content: input.trim(),
        createdAt: Date.now(),
      };

      dispatch({
        type: "ADD_CHAT_MESSAGE",
        threadId: selectedThread.id,
        message: userMessage,
      });

      const assistantMessage: ChatMessage = {
        id: `msg-${Date.now()}-assistant`,
        role: "assistant",
        content: "",
        createdAt: Date.now(),
      };

      dispatch({
        type: "ADD_CHAT_MESSAGE",
        threadId: selectedThread.id,
        message: assistantMessage,
      });

      dispatch({
        type: "SET_STREAMING",
        threadId: selectedThread.id,
        streaming: true,
      });

      setInput("");

      const allMessages = [...selectedThread.chatMessages, userMessage];

      try {
        await streamChatResponse(
          provider,
          allMessages,
          selectedThread.model ?? undefined,
          (_delta, accumulated) => {
            dispatch({
              type: "UPDATE_STREAMING_MESSAGE",
              threadId: selectedThread.id,
              content: accumulated,
            });
          },
        );
      } catch (err) {
        const errorMsg =
          err instanceof Error ? err.message : "Unknown error occurred";
        dispatch({
          type: "UPDATE_STREAMING_MESSAGE",
          threadId: selectedThread.id,
          content: `Error: ${errorMsg}`,
        });
      } finally {
        dispatch({
          type: "SET_STREAMING",
          threadId: selectedThread.id,
          streaming: false,
        });
        dispatch({
          type: "MARK_ACTIVITY",
          threadId: selectedThread.id,
        });
      }
    },
    [selectedThread, input, state.providers, dispatch],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  if (!selectedThread || selectedThread.threadType !== "chat") {
    return null;
  }

  const provider = state.providers.find(
    (p) => p.id === selectedThread.providerId,
  );

  return (
    <div className="chat-wrapper">
      <ChatToolbar thread={selectedThread} />
      <div className="chat-messages">
        {selectedThread.chatMessages.length === 0 && (
          <div className="chat-empty">
            <p>
              {provider
                ? `Connected to ${provider.label}. Send a message to start chatting.`
                : "No provider configured. Add one in settings."}
            </p>
          </div>
        )}
        {selectedThread.chatMessages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {selectedThread.isStreaming && (
          <div className="chat-streaming-indicator">
            <span className="streaming-dot" />
            <span className="streaming-dot" />
            <span className="streaming-dot" />
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <form className="chat-input-bar" onSubmit={handleSubmit}>
        <textarea
          ref={textareaRef}
          className="chat-input"
          placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={selectedThread.isStreaming}
        />
        <button
          type="submit"
          className="compose-send"
          disabled={!input.trim() || selectedThread.isStreaming}
        >
          &uarr;
        </button>
      </form>
    </div>
  );
}
