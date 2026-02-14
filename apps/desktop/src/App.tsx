import { useEffect, useRef } from "react";
import { AppStateProvider, useAppState, useAppDispatch } from "./store";
import Layout from "./components/Layout";
import Sidebar from "./components/Sidebar";
import ThreadList from "./components/ThreadList";
import RepliesView from "./components/RepliesView";
import SettingsView from "./components/SettingsView";
import TerminalManager from "./components/TerminalManager";

const SESSION_CHANNEL_KEY = "titan:selectedChannelId";
const SESSION_THREAD_KEY = "titan:selectedThreadId";
const PERSIST_KEY = "titan:threads";
const PERSIST_ROOT_KEY = "titan:rootPath";
const PERSIST_SCHEDULED_KEY = "titan:scheduledMessages";

let threadCounter = 1000;

function AppInner() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", state.theme);
  }, [state.theme]);

  // Check snoozed threads every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      dispatch({ type: "WAKE_SNOOZED" });
    }, 30_000);
    return () => clearInterval(interval);
  }, [dispatch]);

  // Fire scheduled messages
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      for (const msg of state.scheduledMessages) {
        if (now >= msg.scheduledAt) {
          dispatch({ type: "FIRE_SCHEDULED", messageId: msg.id });
          threadCounter++;
          const id = `thread-${Date.now()}-${threadCounter}`;
          dispatch({
            type: "CREATE_THREAD",
            id,
            channelId: msg.channelId,
            title: msg.prompt,
            ptyId: 0,
          });
        }
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, [dispatch, state.scheduledMessages]);

  // Hydrate persisted threads on startup
  useEffect(() => {
    try {
      const savedThreads = localStorage.getItem(PERSIST_KEY);
      const savedRoot = localStorage.getItem(PERSIST_ROOT_KEY);
      const savedScheduled = localStorage.getItem(PERSIST_SCHEDULED_KEY);
      if (savedThreads) {
        const threads = JSON.parse(savedThreads);
        // Reset PTY state since processes don't survive restart
        const hydrated = threads.map((t: Record<string, unknown>) => ({
          ...t,
          ptyRunning: false,
          ptyExitCode: null,
          ptyId: null,
          hasUnread: false,
          autoTitled: t.autoTitled ?? false,
        }));
        const partial: Record<string, unknown> = { threads: hydrated };
        if (savedRoot) {
          partial.rootPath = savedRoot;
        }
        if (savedScheduled) {
          partial.scheduledMessages = JSON.parse(savedScheduled);
        }
        dispatch({ type: "HYDRATE", state: partial });
      }
    } catch {}
  }, [dispatch]);

  // Restore selection from sessionStorage on channel load
  useEffect(() => {
    if (state.channels.length === 0) return;

    const savedChannel = sessionStorage.getItem(SESSION_CHANNEL_KEY);
    const savedThread = sessionStorage.getItem(SESSION_THREAD_KEY);

    if (savedChannel) {
      dispatch({ type: "SELECT_CHANNEL", channelId: savedChannel });
      if (savedThread) {
        dispatch({ type: "SELECT_THREAD", threadId: savedThread });
      }
    } else {
      // Auto-select first channel
      dispatch({ type: "SELECT_CHANNEL", channelId: state.channels[0].id });
    }
    // Only run when channels are first loaded
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.channels.length > 0]);

  // Persist selection to sessionStorage
  useEffect(() => {
    if (state.selectedChannelId) {
      sessionStorage.setItem(SESSION_CHANNEL_KEY, state.selectedChannelId);
    }
  }, [state.selectedChannelId]);

  useEffect(() => {
    if (state.selectedThreadId) {
      sessionStorage.setItem(SESSION_THREAD_KEY, state.selectedThreadId);
    } else {
      sessionStorage.removeItem(SESSION_THREAD_KEY);
    }
  }, [state.selectedThreadId]);

  // Debounced persistence of threads to localStorage
  useEffect(() => {
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
    }
    persistTimerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(PERSIST_KEY, JSON.stringify(state.threads));
        if (state.rootPath) {
          localStorage.setItem(PERSIST_ROOT_KEY, state.rootPath);
        }
        if (state.scheduledMessages.length > 0) {
          localStorage.setItem(
            PERSIST_SCHEDULED_KEY,
            JSON.stringify(state.scheduledMessages),
          );
        } else {
          localStorage.removeItem(PERSIST_SCHEDULED_KEY);
        }
      } catch {}
    }, 1000);
  }, [state.threads, state.rootPath, state.scheduledMessages]);

  let centerContent: React.ReactNode;
  if (state.currentView === "replies") {
    centerContent = <RepliesView />;
  } else if (state.currentView === "settings") {
    centerContent = <SettingsView />;
  } else {
    centerContent = <ThreadList />;
  }

  return (
    <Layout
      sidebar={<Sidebar />}
      centerContent={centerContent}
      terminal={<TerminalManager />}
      showTerminal={state.selectedThreadId !== null}
    />
  );
}

export default function App() {
  return (
    <AppStateProvider>
      <AppInner />
    </AppStateProvider>
  );
}
