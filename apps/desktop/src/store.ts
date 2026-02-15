import {
  type Dispatch,
  type ReactNode,
  createContext,
  useContext,
} from "react";
import { createElement, useReducer } from "react";
import type {
  AppState,
  AppView,
  Channel,
  ChatMessage,
  ProviderConfig,
  ScheduledMessage,
  Thread,
  ThreadStatus,
  ThreadType,
  Theme,
} from "./types";

export type Action =
  | { type: "SET_CHANNELS"; channels: Channel[]; rootPath: string }
  | {
      type: "CREATE_THREAD";
      id: string;
      channelId: string;
      title: string;
      ptyId: number;
    }
  | {
      type: "CREATE_CHAT_THREAD";
      id: string;
      channelId: string;
      title: string;
      providerId: string;
      model: string;
    }
  | { type: "SELECT_THREAD"; threadId: string }
  | {
      type: "SET_THREAD_STATUS";
      threadId: string;
      status: ThreadStatus;
      snoozeUntil?: number;
    }
  | { type: "MARK_ACTIVITY"; threadId: string }
  | { type: "SELECT_CHANNEL"; channelId: string }
  | { type: "SET_OUTPUT_PREVIEW"; threadId: string; preview: string }
  | { type: "MARK_ALL_READ" }
  | { type: "WAKE_SNOOZED" }
  | { type: "KILL_THREAD_PTY"; threadId: string }
  | { type: "SET_PTY_EXITED"; threadId: string; exitCode: number }
  | { type: "SET_PTY_RUNNING"; threadId: string }
  // Chat-specific actions
  | {
      type: "ADD_CHAT_MESSAGE";
      threadId: string;
      message: ChatMessage;
    }
  | {
      type: "SET_CHAT_MESSAGES";
      threadId: string;
      messages: ChatMessage[];
    }
  | { type: "SET_STREAMING"; threadId: string; streaming: boolean }
  | { type: "UPDATE_STREAMING_MESSAGE"; threadId: string; content: string }
  // Provider actions
  | { type: "SET_PROVIDERS"; providers: ProviderConfig[] }
  | { type: "ADD_PROVIDER"; provider: ProviderConfig }
  | { type: "UPDATE_PROVIDER"; provider: ProviderConfig }
  | { type: "REMOVE_PROVIDER"; providerId: string }
  | { type: "SET_DEFAULT_PROVIDER"; providerId: string }
  // Theme, view, rename, scheduling
  | { type: "TOGGLE_THEME" }
  | { type: "SET_VIEW"; view: AppView }
  | { type: "RENAME_THREAD"; threadId: string; title: string }
  | { type: "SCHEDULE_MESSAGE"; message: ScheduledMessage }
  | { type: "CANCEL_SCHEDULED"; messageId: string }
  | { type: "FIRE_SCHEDULED"; messageId: string }
  | { type: "SET_AUTO_RUN_COMMAND"; command: string | null }
  | { type: "DELETE_THREAD"; threadId: string }
  | { type: "HYDRATE"; state: Partial<AppState> };

const PROVIDERS_KEY = "titan:providers";
const DEFAULT_PROVIDER_KEY = "titan:defaultProviderId";

function loadProviders(): ProviderConfig[] {
  try {
    const stored = localStorage.getItem(PROVIDERS_KEY);
    if (stored) return JSON.parse(stored);
  } catch {
    // ignore
  }
  return [];
}

function saveProviders(providers: ProviderConfig[]) {
  localStorage.setItem(PROVIDERS_KEY, JSON.stringify(providers));
}

function loadDefaultProviderId(): string | null {
  return localStorage.getItem(DEFAULT_PROVIDER_KEY);
}

function saveDefaultProviderId(id: string | null) {
  if (id) {
    localStorage.setItem(DEFAULT_PROVIDER_KEY, id);
  } else {
    localStorage.removeItem(DEFAULT_PROVIDER_KEY);
  }
}

function loadTheme(): Theme {
  try {
    const saved = localStorage.getItem("titan:theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {}
  return "dark";
}

function loadAutoRunCommand(): string | null {
  try {
    const saved = localStorage.getItem("titan:autoRunCommand");
    if (saved !== null) return saved || null;
  } catch {}
  return "claude";
}

const initialState: AppState = {
  channels: [],
  threads: [],
  selectedChannelId: null,
  selectedThreadId: null,
  rootPath: null,
  theme: loadTheme(),
  currentView: "threads",
  scheduledMessages: [],
  autoRunCommand: loadAutoRunCommand(),
  providers: loadProviders(),
  defaultProviderId: loadDefaultProviderId(),
};

function deriveUnread(
  thread: Thread,
  selectedThreadId: string | null,
): boolean {
  if (thread.id === selectedThreadId) return false;
  return thread.lastActivityAt > (thread.lastReadAt ?? 0);
}

function makeThread(
  base: Pick<Thread, "id" | "channelId" | "title"> & {
    threadType: ThreadType;
    ptyId?: number;
    providerId?: string;
    model?: string;
    autoTitled?: boolean;
  },
): Thread {
  const now = Date.now();
  return {
    id: base.id,
    channelId: base.channelId,
    title: base.title,
    status: "active",
    createdAt: now,
    lastActivityAt: now,
    lastReadAt: now,
    hasUnread: false,
    snoozeUntil: null,
    snoozeDue: false,
    lastOutputPreview: null,
    threadType: base.threadType,
    ptyId: base.ptyId ?? null,
    ptyRunning: base.threadType === "terminal",
    ptyExitCode: null,
    autoTitled: base.autoTitled ?? false,
    chatMessages: [],
    model: base.model ?? null,
    providerId: base.providerId ?? null,
    isStreaming: false,
  };
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "SET_CHANNELS":
      return {
        ...state,
        channels: action.channels,
        rootPath: action.rootPath,
      };

    case "CREATE_THREAD": {
      const thread = makeThread({
        id: action.id,
        channelId: action.channelId,
        title: action.title || "New thread",
        threadType: "terminal",
        ptyId: action.ptyId,
        autoTitled: !action.title || action.title === "New thread",
      });
      return {
        ...state,
        threads: [...state.threads, thread],
        selectedThreadId: action.id,
        selectedChannelId: action.channelId,
        currentView: "threads",
      };
    }

    case "CREATE_CHAT_THREAD": {
      const thread = makeThread({
        id: action.id,
        channelId: action.channelId,
        title: action.title || "New chat",
        threadType: "chat",
        providerId: action.providerId,
        model: action.model,
      });
      return {
        ...state,
        threads: [...state.threads, thread],
        selectedThreadId: action.id,
        selectedChannelId: action.channelId,
        currentView: "threads",
      };
    }

    case "SELECT_THREAD": {
      const now = Date.now();
      const threads = state.threads.map((t) => {
        if (t.id === action.threadId) {
          return {
            ...t,
            lastReadAt: now,
            hasUnread: false,
            snoozeDue: false,
          };
        }
        return t;
      });
      return { ...state, threads, selectedThreadId: action.threadId };
    }

    case "SET_THREAD_STATUS": {
      const threads = state.threads.map((t) => {
        if (t.id !== action.threadId) return t;
        const snoozeUntil =
          action.status === "snoozed" ? (action.snoozeUntil ?? null) : null;
        return {
          ...t,
          status: action.status,
          snoozeUntil,
          snoozeDue: false,
        };
      });
      return { ...state, threads };
    }

    case "MARK_ACTIVITY": {
      const now = Date.now();
      const threads = state.threads.map((t) => {
        if (t.id === action.threadId) {
          const updated = { ...t, lastActivityAt: now };
          return {
            ...updated,
            hasUnread: deriveUnread(updated, state.selectedThreadId),
          };
        }
        return t;
      });
      return { ...state, threads };
    }

    case "SELECT_CHANNEL":
      return {
        ...state,
        selectedChannelId: action.channelId,
        selectedThreadId: null,
        currentView: "threads",
      };

    case "SET_OUTPUT_PREVIEW": {
      const threads = state.threads.map((t) =>
        t.id === action.threadId
          ? { ...t, lastOutputPreview: action.preview }
          : t,
      );
      return { ...state, threads };
    }

    case "MARK_ALL_READ": {
      const now = Date.now();
      const threads = state.threads.map((t) => {
        if (t.hasUnread || t.snoozeDue) {
          return { ...t, hasUnread: false, snoozeDue: false, lastReadAt: now };
        }
        return t;
      });
      return { ...state, threads };
    }

    case "WAKE_SNOOZED": {
      const now = Date.now();
      let changed = false;
      const threads = state.threads.map((t) => {
        if (
          t.status === "snoozed" &&
          t.snoozeUntil !== null &&
          now >= t.snoozeUntil &&
          !t.snoozeDue
        ) {
          changed = true;
          return { ...t, snoozeDue: true };
        }
        return t;
      });
      return changed ? { ...state, threads } : state;
    }

    case "KILL_THREAD_PTY": {
      const threads = state.threads.map((t) =>
        t.id === action.threadId
          ? { ...t, ptyId: null, ptyRunning: false, ptyExitCode: -1, status: "inactive" as const }
          : t,
      );
      return { ...state, threads };
    }

    case "SET_PTY_EXITED": {
      const threads = state.threads.map((t) =>
        t.id === action.threadId
          ? { ...t, ptyRunning: false, ptyExitCode: action.exitCode }
          : t,
      );
      return { ...state, threads };
    }

    case "SET_PTY_RUNNING": {
      const threads = state.threads.map((t) =>
        t.id === action.threadId
          ? { ...t, ptyRunning: true, ptyExitCode: null }
          : t,
      );
      return { ...state, threads };
    }

    // Chat-specific actions
    case "ADD_CHAT_MESSAGE": {
      const threads = state.threads.map((t) => {
        if (t.id !== action.threadId) return t;
        const messages = [...t.chatMessages, action.message];
        const preview =
          action.message.content.length > 120
            ? `${action.message.content.slice(0, 120)}...`
            : action.message.content;
        return {
          ...t,
          chatMessages: messages,
          lastActivityAt: Date.now(),
          lastOutputPreview: preview,
        };
      });
      return { ...state, threads };
    }

    case "SET_CHAT_MESSAGES": {
      const threads = state.threads.map((t) => {
        if (t.id !== action.threadId) return t;
        const lastMsg = action.messages[action.messages.length - 1];
        const preview = lastMsg
          ? lastMsg.content.length > 120
            ? `${lastMsg.content.slice(0, 120)}...`
            : lastMsg.content
          : t.lastOutputPreview;
        return {
          ...t,
          chatMessages: action.messages,
          lastOutputPreview: preview,
        };
      });
      return { ...state, threads };
    }

    case "SET_STREAMING": {
      const threads = state.threads.map((t) =>
        t.id === action.threadId ? { ...t, isStreaming: action.streaming } : t,
      );
      return { ...state, threads };
    }

    case "UPDATE_STREAMING_MESSAGE": {
      const threads = state.threads.map((t) => {
        if (t.id !== action.threadId) return t;
        const messages = [...t.chatMessages];
        const lastIdx = messages.length - 1;
        if (lastIdx >= 0 && messages[lastIdx].role === "assistant") {
          messages[lastIdx] = { ...messages[lastIdx], content: action.content };
        }
        return { ...t, chatMessages: messages };
      });
      return { ...state, threads };
    }

    // Provider actions
    case "SET_PROVIDERS": {
      saveProviders(action.providers);
      return { ...state, providers: action.providers };
    }

    case "ADD_PROVIDER": {
      const providers = [...state.providers, action.provider];
      saveProviders(providers);
      const defaultProviderId = state.defaultProviderId ?? action.provider.id;
      saveDefaultProviderId(defaultProviderId);
      return { ...state, providers, defaultProviderId };
    }

    case "UPDATE_PROVIDER": {
      const providers = state.providers.map((p) =>
        p.id === action.provider.id ? action.provider : p,
      );
      saveProviders(providers);
      return { ...state, providers };
    }

    case "REMOVE_PROVIDER": {
      const providers = state.providers.filter(
        (p) => p.id !== action.providerId,
      );
      saveProviders(providers);
      const defaultProviderId =
        state.defaultProviderId === action.providerId
          ? (providers[0]?.id ?? null)
          : state.defaultProviderId;
      saveDefaultProviderId(defaultProviderId);
      return { ...state, providers, defaultProviderId };
    }

    case "SET_DEFAULT_PROVIDER": {
      saveDefaultProviderId(action.providerId);
      return { ...state, defaultProviderId: action.providerId };
    }

    case "TOGGLE_THEME": {
      const newTheme: Theme = state.theme === "dark" ? "light" : "dark";
      try {
        localStorage.setItem("titan:theme", newTheme);
      } catch {}
      return { ...state, theme: newTheme };
    }

    case "SET_AUTO_RUN_COMMAND": {
      const cmd = action.command;
      try {
        if (cmd) {
          localStorage.setItem("titan:autoRunCommand", cmd);
        } else {
          localStorage.removeItem("titan:autoRunCommand");
        }
      } catch {}
      return { ...state, autoRunCommand: cmd };
    }

    case "SET_VIEW":
      return { ...state, currentView: action.view };

    case "RENAME_THREAD": {
      const threads = state.threads.map((t) =>
        t.id === action.threadId
          ? { ...t, title: action.title, autoTitled: false }
          : t,
      );
      return { ...state, threads };
    }

    case "SCHEDULE_MESSAGE":
      return {
        ...state,
        scheduledMessages: [...state.scheduledMessages, action.message],
      };

    case "CANCEL_SCHEDULED":
      return {
        ...state,
        scheduledMessages: state.scheduledMessages.filter(
          (m) => m.id !== action.messageId,
        ),
      };

    case "FIRE_SCHEDULED":
      return {
        ...state,
        scheduledMessages: state.scheduledMessages.filter(
          (m) => m.id !== action.messageId,
        ),
      };

    case "DELETE_THREAD": {
      const threads = state.threads.filter((t) => t.id !== action.threadId);
      const selectedThreadId =
        state.selectedThreadId === action.threadId
          ? null
          : state.selectedThreadId;
      return { ...state, threads, selectedThreadId };
    }

    case "HYDRATE":
      return { ...state, ...action.state };

    default:
      return state;
  }
}

const AppStateContext = createContext<AppState>(initialState);
const AppDispatchContext = createContext<Dispatch<Action>>(() => {});

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  return createElement(
    AppStateContext.Provider,
    { value: state },
    createElement(AppDispatchContext.Provider, { value: dispatch }, children),
  );
}

export function useAppState() {
  return useContext(AppStateContext);
}

export function useAppDispatch() {
  return useContext(AppDispatchContext);
}
