import { useEffect, useRef, useCallback, useState } from "react";
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
  claudeStarted: boolean;
  promptSent: boolean;
  autoTitleDone: boolean;
}

export const DARK_TERM_THEME = {
  background: "#0c0a09",
  foreground: "#d6d3d1",
  cursor: "#d6d3d1",
  cursorAccent: "#0c0a09",
  selectionBackground: "#7c6fef40",
};

export const LIGHT_TERM_THEME = {
  background: "#1c1917",
  foreground: "#d6d3d1",
  cursor: "#d6d3d1",
  cursorAccent: "#1c1917",
  selectionBackground: "#7c6fef40",
};

const TERM_OPTIONS = {
  fontFamily: '"SF Mono", Menlo, monospace',
  fontSize: 13,
  theme: DARK_TERM_THEME,
  cursorBlink: true,
  allowProposedApi: true,
};

const STATUS_LABELS: Record<ThreadStatus, string> = {
  active: "\u25B6 Active",
  snoozed: "\u23F8 Snoozed",
  done: "\u2713 Done",
};

function ThreadToolbar() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

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

  const startEditing = () => {
    setEditValue(selectedThread.title);
    setEditing(true);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  };

  const commitRename = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== selectedThread.title) {
      dispatch({
        type: "RENAME_THREAD",
        threadId: selectedThread.id,
        title: trimmed,
      });
    }
    setEditing(false);
  };

  return (
    <div className="thread-toolbar">
      <div className="thread-toolbar-left">
        <span
          className={`pty-status-dot ${selectedThread.ptyRunning ? "running" : "exited"}`}
        />
        {editing ? (
          <input
            ref={inputRef}
            className="thread-toolbar-title-edit"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setEditing(false);
            }}
            onBlur={commitRename}
          />
        ) : (
          <span
            className="thread-toolbar-title"
            onClick={startEditing}
            title="Click to rename"
          >
            {selectedThread.title}
          </span>
        )}
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
  const threadsRef = useRef(state.threads);

  selectedIdRef.current = state.selectedThreadId;
  threadsRef.current = state.threads;

  const autoRunCommandRef = useRef(state.autoRunCommand);
  autoRunCommandRef.current = state.autoRunCommand;

  const spawnPty = useCallback(
    (
      instance: TerminalInstance,
      threadId: string,
      cwd?: string,
      pendingPrompt?: string,
    ) => {
      const pty = spawn("/bin/zsh", [], {
        cols: instance.terminal.cols,
        rows: instance.terminal.rows,
        cwd,
      });

      instance.pty = pty;

      // Auto-run configured command after shell initializes
      const cmd = autoRunCommandRef.current;
      if (cmd) {
        setTimeout(() => {
          if (instance.pty && !instance.claudeStarted) {
            instance.claudeStarted = true;
            instance.pty.write(`${cmd}\n`);

            // If there's a pending prompt, send it after the CLI starts
            if (pendingPrompt) {
              setTimeout(() => {
                if (instance.pty && !instance.promptSent) {
                  instance.promptSent = true;
                  instance.pty.write(`${pendingPrompt}\n`);
                }
              }, 2500);
            }
          }
        }, 500);
      }

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

          // Auto-title: generate title from first meaningful output
          if (!instance.autoTitleDone && instance.claudeStarted) {
            const thread = threadsRef.current.find(
              (t) => t.id === threadId,
            );
            if (thread?.autoTitled) {
              const currentCmd = autoRunCommandRef.current ?? "";
              for (const line of lines) {
                const trimmed = line.trim();
                // Skip empty, shell prompts, and the auto-run command itself
                if (
                  trimmed.length > 3 &&
                  !trimmed.startsWith("$") &&
                  !trimmed.startsWith("%") &&
                  trimmed !== currentCmd &&
                  !trimmed.startsWith("╭") &&
                  !trimmed.startsWith("╰") &&
                  !trimmed.startsWith(">")
                ) {
                  instance.autoTitleDone = true;
                  const title =
                    trimmed.length > 60
                      ? `${trimmed.slice(0, 60)}...`
                      : trimmed;
                  dispatch({
                    type: "RENAME_THREAD",
                    threadId,
                    title,
                  });
                  break;
                }
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
    (
      threadId: string,
      cwd?: string,
      pendingPrompt?: string,
    ): TerminalInstance | null => {
      const wrapper = wrapperRef.current;
      if (!wrapper) return null;

      const containerEl = document.createElement("div");
      containerEl.className = "terminal-pane";
      containerEl.style.display = "none";
      wrapper.appendChild(containerEl);

      const terminal = new Terminal({
        ...TERM_OPTIONS,
        theme: state.theme === "dark" ? DARK_TERM_THEME : LIGHT_TERM_THEME,
      });
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
        claudeStarted: false,
        promptSent: false,
        autoTitleDone: false,
      };

      spawnPty(instance, threadId, cwd, pendingPrompt);
      instancesRef.current.set(threadId, instance);
      return instance;
    },
    [spawnPty, state.theme],
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
      instance.claudeStarted = false;
      instance.promptSent = false;
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
        // Use thread title as the pending prompt if it's not the placeholder
        const pendingPrompt =
          thread.title && thread.title !== "New thread"
            ? thread.title
            : undefined;
        createInstance(thread.id, thread.channelId, pendingPrompt);
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

  // Update terminal theme when app theme changes
  useEffect(() => {
    const theme =
      state.theme === "dark" ? DARK_TERM_THEME : LIGHT_TERM_THEME;
    for (const [, instance] of instancesRef.current) {
      instance.terminal.options.theme = theme;
    }
  }, [state.theme]);

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
