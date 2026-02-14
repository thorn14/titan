import {
  type Dispatch,
  type ReactNode,
  createContext,
  useContext,
} from "react";
import { createElement, useReducer } from "react";
import type {
  AppState,
  Channel,
  GitStatus,
  Thread,
  ThreadStatus,
} from "./types";

export type Action =
  | { type: "SET_CHANNELS"; channels: Channel[]; rootPath: string }
  | {
      type: "CREATE_THREAD";
      id: string;
      channelId: string;
      title: string;
      ptyId: number;
      branch?: string | null;
      branchAutoCreated?: boolean;
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
  | { type: "SET_GIT_STATUS"; gitStatus: GitStatus }
  | {
      type: "ATTACH_BRANCH";
      threadId: string;
      branch: string;
      autoCreated?: boolean;
    }
  | { type: "DETACH_BRANCH"; threadId: string };

const initialState: AppState = {
  channels: [],
  threads: [],
  selectedChannelId: null,
  selectedThreadId: null,
  rootPath: null,
  gitStatus: null,
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
        branch: action.branch ?? null,
        branchAutoCreated: action.branchAutoCreated ?? false,
      };
      return {
        ...state,
        threads: [...state.threads, thread],
        selectedThreadId: action.id,
        selectedChannelId: action.channelId,
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
        t.id === action.threadId ? { ...t, ptyId: null, ptyRunning: false } : t,
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

    case "SET_GIT_STATUS":
      return { ...state, gitStatus: action.gitStatus };

    case "ATTACH_BRANCH": {
      const threads = state.threads.map((t) =>
        t.id === action.threadId
          ? {
              ...t,
              branch: action.branch,
              branchAutoCreated: action.autoCreated ?? false,
            }
          : t,
      );
      return { ...state, threads };
    }

    case "DETACH_BRANCH": {
      const threads = state.threads.map((t) =>
        t.id === action.threadId
          ? { ...t, branch: null, branchAutoCreated: false }
          : t,
      );
      return { ...state, threads };
    }

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
