import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "@xterm/addon-fit";
import { spawn } from "tauri-pty";
import type { IPty, IDisposable } from "tauri-pty";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useAppState, useAppDispatch } from "../store";
import { SNOOZE_OPTIONS, type SnoozeOption } from "../snooze";
import type { ThreadStatus } from "../types";
import "xterm/css/xterm.css";

// Strip ANSI escape codes from terminal output
function stripAnsi(str: string): string {
  return str.replace(
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI
    /[\u001b\u009b][[\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nq-uy=><~]/g,
    "",
  );
}

interface TerminalInstance {
  terminal: Terminal;
  fitAddon: FitAddon;
  pty: IPty | null;
  disposables: IDisposable[];
  containerEl: HTMLDivElement;
  outputLines: string[];
  previewTimer: ReturnType<typeof setTimeout> | null;
}

const TERM_OPTIONS = {
  fontFamily: '"SF Mono", Menlo, monospace',
  fontSize: 13,
  theme: {
    background: "#141433",
    foreground: "#bbbdc9",
    cursor: "#bbbdc9",
    cursorAccent: "#141433",
    selectionBackground: "#7c6fef40",
  },
  cursorBlink: true,
  allowProposedApi: true,
} as const;

const STATUS_LABELS: Record<ThreadStatus, string> = {
  active: "\u25B6 Active",
  snoozed: "\u23F8 Snoozed",
  done: "\u2713 Done",
};

function ThreadToolbar() {
  const state = useAppState();
  const dispatch = useAppDispatch();

  const selectedThread = state.threads.find(
    (t) => t.id === state.selectedThreadId,
  );
  if (!selectedThread) return null;

  const handleStatusChange = (status: ThreadStatus) => {
    dispatch({
      type: "SET_THREAD_STATUS",
      threadId: selectedThread.id,
      status,
    });
  };

  const handleSnooze = (option: SnoozeOption) => {
    dispatch({
      type: "SET_THREAD_STATUS",
      threadId: selectedThread.id,
      status: "snoozed",
      snoozeUntil: option.getTimestamp(),
    });
  };

  return (
    <div className="thread-toolbar">
      <div className="thread-toolbar-left">
        <span
          className={`pty-status-dot ${selectedThread.ptyRunning ? "running" : "exited"}`}
        />
        <span className="thread-toolbar-title">{selectedThread.title}</span>
      </div>
      <div className="thread-toolbar-actions">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button type="button" className="status-dropdown-trigger">
              {STATUS_LABELS[selectedThread.status]}
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
                className={`dropdown-item ${selectedThread.status === "active" ? "active" : ""}`}
                onSelect={() => handleStatusChange("active")}
              >
                {STATUS_LABELS.active}
              </DropdownMenu.Item>

              <DropdownMenu.Sub>
                <DropdownMenu.SubTrigger
                  className={`dropdown-item dropdown-sub-trigger ${selectedThread.status === "snoozed" ? "active" : ""}`}
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
                className={`dropdown-item ${selectedThread.status === "done" ? "active" : ""}`}
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

function ExitBanner({
  threadId,
  exitCode,
  onRestart,
}: {
  threadId: string;
  exitCode: number | null;
  onRestart: (threadId: string) => void;
}) {
  if (exitCode === null) return null;
  return (
    <div className="exit-banner">
      <span className="exit-banner-text">
        Process exited (code {exitCode})
      </span>
      <button
        type="button"
        className="exit-banner-btn"
        onClick={() => onRestart(threadId)}
      >
        Restart
      </button>
    </div>
  );
}

export default function TerminalManager() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const instancesRef = useRef<Map<string, TerminalInstance>>(new Map());
  const selectedIdRef = useRef<string | null>(null);

  selectedIdRef.current = state.selectedThreadId;

  const spawnPty = useCallback(
    (instance: TerminalInstance, threadId: string, cwd?: string) => {
      const pty = spawn("/bin/zsh", [], {
        cols: instance.terminal.cols,
        rows: instance.terminal.rows,
        cwd,
      });

      instance.pty = pty;

      instance.disposables.push(
        pty.onData((rawData) => {
          const data =
            typeof rawData === "string"
              ? rawData
              : rawData instanceof Uint8Array
                ? rawData
                : new Uint8Array(rawData);

          instance.terminal.write(data);

          const decoded =
            typeof data === "string"
              ? data
              : new TextDecoder().decode(data);
          const cleaned = stripAnsi(decoded);
          const lines = cleaned.split(/\r?\n/);
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.length > 0) {
              instance.outputLines.push(trimmed);
              if (instance.outputLines.length > 5) {
                instance.outputLines.shift();
              }
            }
          }

          if (!instance.previewTimer) {
            instance.previewTimer = setTimeout(() => {
              instance.previewTimer = null;
              const lastLine =
                instance.outputLines[instance.outputLines.length - 1];
              if (lastLine) {
                dispatch({
                  type: "SET_OUTPUT_PREVIEW",
                  threadId,
                  preview:
                    lastLine.length > 120
                      ? `${lastLine.slice(0, 120)}...`
                      : lastLine,
                });
              }
            }, 2000);
          }

          if (selectedIdRef.current !== threadId) {
            dispatch({ type: "MARK_ACTIVITY", threadId });
          }
        }),
      );

      instance.disposables.push(
        pty.onExit(({ exitCode }) => {
          dispatch({ type: "SET_PTY_EXITED", threadId, exitCode });
        }),
      );

      instance.disposables.push(
        instance.terminal.onData((data) => {
          if (instance.pty) {
            instance.pty.write(data);
          }
        }),
      );

      instance.disposables.push(
        instance.terminal.onResize(({ cols, rows }) => {
          if (instance.pty) {
            instance.pty.resize(cols, rows);
          }
        }),
      );
    },
    [dispatch],
  );

  const createInstance = useCallback(
    (threadId: string, cwd?: string): TerminalInstance | null => {
      const wrapper = wrapperRef.current;
      if (!wrapper) return null;

      const containerEl = document.createElement("div");
      containerEl.className = "terminal-pane";
      containerEl.style.display = "none";
      wrapper.appendChild(containerEl);

      const terminal = new Terminal(TERM_OPTIONS);
      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(containerEl);

      const instance: TerminalInstance = {
        terminal,
        fitAddon,
        pty: null,
        disposables: [],
        containerEl,
        outputLines: [],
        previewTimer: null,
      };

      spawnPty(instance, threadId, cwd);
      instancesRef.current.set(threadId, instance);
      return instance;
    },
    [spawnPty],
  );

  const handleRestart = useCallback(
    (threadId: string) => {
      const instance = instancesRef.current.get(threadId);
      if (!instance) return;

      const thread = state.threads.find((t) => t.id === threadId);
      const cwd = thread?.channelId;

      // Clear old disposables (pty-related)
      for (const d of instance.disposables) d.dispose();
      instance.disposables = [];

      instance.terminal.clear();
      dispatch({ type: "SET_PTY_RUNNING", threadId });
      spawnPty(instance, threadId, cwd);

      requestAnimationFrame(() => {
        instance.fitAddon.fit();
        instance.terminal.focus();
      });
    },
    [dispatch, spawnPty, state.threads],
  );

  // Create instances for new threads
  useEffect(() => {
    for (const thread of state.threads) {
      if (!instancesRef.current.has(thread.id)) {
        // channelId is the folder path — use it as cwd
        createInstance(thread.id, thread.channelId);
      }
    }
  }, [state.threads, createInstance]);

  // Show/hide terminals based on selected thread
  useEffect(() => {
    const instances = instancesRef.current;
    for (const [threadId, instance] of instances) {
      if (threadId === state.selectedThreadId) {
        instance.containerEl.style.display = "block";
        requestAnimationFrame(() => {
          instance.fitAddon.fit();
          instance.terminal.focus();
        });
      } else {
        instance.containerEl.style.display = "none";
      }
    }
  }, [state.selectedThreadId]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      const selectedId = selectedIdRef.current;
      if (selectedId) {
        const instance = instancesRef.current.get(selectedId);
        if (instance) {
          instance.fitAddon.fit();
        }
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    const instances = instancesRef.current;
    return () => {
      for (const [, instance] of instances) {
        if (instance.previewTimer) clearTimeout(instance.previewTimer);
        for (const d of instance.disposables) d.dispose();
        if (instance.pty) instance.pty.kill();
        instance.terminal.dispose();
        instance.containerEl.remove();
      }
      instances.clear();
    };
  }, []);

  const hasSelected = state.selectedThreadId !== null;
  const selectedThread = state.threads.find(
    (t) => t.id === state.selectedThreadId,
  );

  return (
    <div className="terminal-wrapper">
      {hasSelected && <ThreadToolbar />}
      <div className="terminal-area">
        <div
          ref={wrapperRef}
          className="terminal-manager"
          style={{ display: hasSelected ? "block" : "none" }}
        />
        {selectedThread && selectedThread.ptyExitCode !== null && (
          <ExitBanner
            threadId={selectedThread.id}
            exitCode={selectedThread.ptyExitCode}
            onRestart={handleRestart}
          />
        )}
      </div>
    </div>
  );
}
