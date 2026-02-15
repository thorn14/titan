import {
  createContext,
  useContext,
  type Dispatch,
  type ReactNode,
} from "react";
import { useReducer, createElement } from "react";
import type {
  AppState,
  AppView,
  Channel,
  ScheduledMessage,
  Thread,
  ThreadStatus,
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
  | { type: "TOGGLE_THEME" }
  | { type: "SET_VIEW"; view: AppView }
  | { type: "RENAME_THREAD"; threadId: string; title: string }
  | { type: "SCHEDULE_MESSAGE"; message: ScheduledMessage }
  | { type: "CANCEL_SCHEDULED"; messageId: string }
  | { type: "FIRE_SCHEDULED"; messageId: string }
  | { type: "SET_AUTO_RUN_COMMAND"; command: string | null }
  | { type: "HYDRATE"; state: Partial<AppState> };

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
};

function deriveUnread(
  thread: Thread,
  selectedThreadId: string | null,
): boolean {
  if (thread.id === selectedThreadId) return false;
  return thread.lastActivityAt > (thread.lastReadAt ?? 0);
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
      const now = Date.now();
      const thread: Thread = {
        id: action.id,
        channelId: action.channelId,
        title: action.title,
        status: "active",
        createdAt: now,
        lastActivityAt: now,
        lastReadAt: now,
        ptyId: action.ptyId,
        hasUnread: false,
        snoozeUntil: null,
        snoozeDue: false,
        lastOutputPreview: null,
        ptyRunning: true,
        ptyExitCode: null,
        autoTitled: !action.title || action.title === "New thread",
      };
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
