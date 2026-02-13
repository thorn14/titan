import { useEffect } from "react";
import { AppStateProvider, useAppState, useAppDispatch } from "./store";
import Layout from "./components/Layout";
import Sidebar from "./components/Sidebar";
import ThreadList from "./components/ThreadList";
import TerminalManager from "./components/TerminalManager";

const SESSION_CHANNEL_KEY = "titan:selectedChannelId";
const SESSION_THREAD_KEY = "titan:selectedThreadId";

function AppInner() {
  const state = useAppState();
  const dispatch = useAppDispatch();

  // Check snoozed threads every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      dispatch({ type: "WAKE_SNOOZED" });
    }, 30_000);
    return () => clearInterval(interval);
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

  return (
    <Layout
      sidebar={<Sidebar />}
      threadList={<ThreadList />}
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
