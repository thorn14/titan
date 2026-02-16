/**
 * PTY RAG Pipeline — TypeScript side
 *
 * Captures terminal output, detects command boundaries via sentinel markers,
 * strips ANSI, and sends chunks to the Rust backend for embedding + storage.
 *
 * Architecture:
 *   PTY onData → PtyRagTap.onBytes() → sentinel detection → chunk extraction
 *   → invoke("pty_rag_ingest") → Rust embedder → SQLite
 */

import { invoke } from "@tauri-apps/api/core";

// ─── Sentinel Protocol ──────────────────────────────────────────────
//
// Sentinel: OSC escape \x1b]7777;TITAN_PROMPT\x07<cwd>\x07
// Injected via PROMPT_COMMAND (bash/zsh) or fish_prompt (fish).
// Terminals ignore unknown OSC codes, so this is invisible to the user.

const SENTINEL_PREFIX = "\x1b]7777;TITAN_PROMPT\x07";
const SENTINEL_BELL = "\x07";

// ─── ANSI Stripping ─────────────────────────────────────────────────

function stripAnsiForRag(str: string): string {
  return (
    str
      // Standard ANSI escape sequences (colors, cursor movement, etc.)
      // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI
      .replace(
        /[\u001b\u009b][[\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nq-uy=><~]/g,
        "",
      )
      // OSC sequences (window titles, hyperlinks, etc.)
      // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping OSC
      .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, "")
      // Remaining control characters (keep \t, \n, \r)
      // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
  );
}

// ─── Types ──────────────────────────────────────────────────────────

export interface RawChunk {
  session_id: string;
  thread_id: string;
  timestamp: number;
  cwd: string | null;
  command: string;
  output: string;
}

export interface SearchResult {
  id: number;
  session_id: string;
  thread_id: string;
  timestamp: number;
  cwd: string | null;
  command: string;
  output_preview: string;
  distance: number | null;
}

export interface FullChunk {
  id: number;
  session_id: string;
  thread_id: string;
  timestamp: number;
  cwd: string | null;
  command: string;
  output: string;
}

export interface RagStatus {
  db_available: boolean;
  embedder_available: boolean;
  db_path: string;
  model_dir: string | null;
}

export interface RagConfigureResult {
  enabled: boolean;
}

// ─── Tauri Command Wrappers ─────────────────────────────────────────

export async function ragIngest(chunk: RawChunk): Promise<number> {
  return invoke<number>("pty_rag_ingest", { chunk });
}

export async function ragSearch(
  query: string,
  limit = 10,
  threadId?: string,
): Promise<SearchResult[]> {
  return invoke<SearchResult[]>("pty_rag_search", {
    query,
    limit,
    thread_id: threadId ?? null,
  });
}

export async function ragRecent(
  n = 10,
  threadId?: string,
): Promise<SearchResult[]> {
  return invoke<SearchResult[]>("pty_rag_recent", {
    n,
    thread_id: threadId ?? null,
  });
}

export async function ragGet(chunkId: number): Promise<FullChunk> {
  return invoke<FullChunk>("pty_rag_get", { chunk_id: chunkId });
}

export async function ragDeleteThread(threadId: string): Promise<number> {
  return invoke<number>("pty_rag_delete_thread", { thread_id: threadId });
}

export async function ragStatus(): Promise<RagStatus> {
  return invoke<RagStatus>("pty_rag_status");
}

/**
 * Configure the embedding model directory at runtime.
 * Pass `null` to disable semantic search entirely.
 * Pass a directory path containing model.onnx + tokenizer.json to enable.
 */
export async function ragConfigureModel(
  modelDir: string | null,
): Promise<RagConfigureResult> {
  return invoke<RagConfigureResult>("pty_rag_configure_model", {
    modelDir,
  });
}

// ─── Output Tap ─────────────────────────────────────────────────────

/**
 * PtyRagTap — attaches to a PTY's byte stream and extracts chunks
 * bounded by sentinel markers.
 *
 * Usage:
 *   const tap = new PtyRagTap(sessionId, threadId);
 *   // In pty.onData callback:
 *   tap.onData(data);
 *   // On PTY exit:
 *   tap.flush();
 */
export class PtyRagTap {
  private buffer = "";
  private sessionId: string;
  private threadId: string;
  private currentCwd: string | null = null;
  private chunkStartTime: number = Date.now();
  private pendingIngest: Promise<void> = Promise.resolve();

  // Fallback: time-based chunking for when sentinels aren't available
  // (e.g., inside Claude CLI sessions that don't produce shell prompts)
  private fallbackBuffer = "";
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly FALLBACK_INTERVAL_MS = 30_000; // 30 seconds
  private readonly FALLBACK_SIZE_THRESHOLD = 4096; // 4KB

  constructor(sessionId: string, threadId: string) {
    this.sessionId = sessionId;
    this.threadId = threadId;
  }

  /**
   * Feed raw terminal output bytes into the tap.
   * Called from the pty.onData() callback.
   */
  onData(data: string): void {
    this.buffer += data;
    const sentinelFound = this.extractChunks();

    // Only accumulate into fallback buffer when no sentinel was found.
    // When sentinels are working, extractChunks handles chunking and
    // clears fallbackBuffer — re-appending here would duplicate content.
    if (!sentinelFound) {
      const stripped = stripAnsiForRag(data);
      if (stripped.trim().length > 0) {
        this.fallbackBuffer += stripped;
        this.scheduleFallbackFlush();

        // Size-based flush
        if (this.fallbackBuffer.length >= this.FALLBACK_SIZE_THRESHOLD) {
          this.flushFallback();
        }
      }
    }
  }

  /**
   * Scan buffer for sentinel sequences and extract command chunks.
   * Returns true if at least one sentinel was found and processed.
   */
  private extractChunks(): boolean {
    let sentinelIdx: number;
    let found = false;

    // biome-ignore lint/suspicious/noAssignInExpressions: loop extraction pattern
    while ((sentinelIdx = this.buffer.indexOf(SENTINEL_PREFIX)) !== -1) {
      found = true;
      // Everything before the sentinel = output of previous command
      const beforeSentinel = this.buffer.slice(0, sentinelIdx);

      // Find the end of the sentinel (cwd terminated by BEL)
      const afterPrefix = this.buffer.slice(
        sentinelIdx + SENTINEL_PREFIX.length,
      );
      const cwdEnd = afterPrefix.indexOf(SENTINEL_BELL);

      if (cwdEnd === -1) {
        // Sentinel is incomplete — wait for more data
        break;
      }

      const cwd = afterPrefix.slice(0, cwdEnd);
      this.buffer = afterPrefix.slice(cwdEnd + SENTINEL_BELL.length);

      // Process the chunk (content before this sentinel)
      if (beforeSentinel.trim().length > 0) {
        const text = stripAnsiForRag(beforeSentinel);
        const { command, output } = splitCommandOutput(text);

        if (command.trim().length > 0) {
          const chunk: RawChunk = {
            session_id: this.sessionId,
            thread_id: this.threadId,
            timestamp: this.chunkStartTime / 1000, // Unix seconds
            cwd: this.currentCwd,
            command,
            output,
          };

          // Clear fallback buffer since sentinel-based chunking is working
          this.fallbackBuffer = "";
          this.cancelFallbackTimer();

          // Fire-and-forget ingest (don't block the PTY read loop)
          this.pendingIngest = this.pendingIngest.then(() =>
            ragIngest(chunk).catch((err) =>
              console.error("[rag] Ingest failed:", err),
            ),
          );
        }
      }

      this.currentCwd = cwd || null;
      this.chunkStartTime = Date.now();
    }

    return found;
  }

  /**
   * Schedule a fallback flush for content that doesn't have sentinel boundaries.
   * This handles long-running processes like Claude CLI.
   */
  private scheduleFallbackFlush(): void {
    if (this.fallbackTimer) return;

    this.fallbackTimer = setTimeout(() => {
      this.fallbackTimer = null;
      this.flushFallback();
    }, this.FALLBACK_INTERVAL_MS);
  }

  private cancelFallbackTimer(): void {
    if (this.fallbackTimer) {
      clearTimeout(this.fallbackTimer);
      this.fallbackTimer = null;
    }
  }

  /**
   * Flush the fallback buffer as a time-based chunk.
   */
  private flushFallback(): void {
    this.cancelFallbackTimer();

    const text = this.fallbackBuffer.trim();
    if (text.length === 0) return;

    // Use first line as "command" for display purposes
    const lines = text.split("\n");
    const command = lines[0].slice(0, 200); // first line, capped
    const output = lines.slice(1).join("\n");

    const chunk: RawChunk = {
      session_id: this.sessionId,
      thread_id: this.threadId,
      timestamp: Date.now() / 1000,
      cwd: this.currentCwd,
      command,
      output,
    };

    this.fallbackBuffer = "";

    this.pendingIngest = this.pendingIngest.then(() =>
      ragIngest(chunk).catch((err) =>
        console.error("[rag] Fallback ingest failed:", err),
      ),
    );
  }

  /**
   * Flush any remaining buffered content. Call on PTY exit.
   */
  flush(): void {
    // Flush sentinel-based buffer
    if (this.buffer.trim().length > 0) {
      const text = stripAnsiForRag(this.buffer);
      const { command, output } = splitCommandOutput(text);

      if (command.trim().length > 0) {
        const chunk: RawChunk = {
          session_id: this.sessionId,
          thread_id: this.threadId,
          timestamp: Date.now() / 1000,
          cwd: this.currentCwd,
          command,
          output,
        };

        this.pendingIngest = this.pendingIngest.then(() =>
          ragIngest(chunk).catch((err) =>
            console.error("[rag] Final ingest failed:", err),
          ),
        );
      }

      this.buffer = "";
    }

    // Flush fallback buffer
    this.flushFallback();
  }

  /**
   * Update the thread ID (e.g., if the thread is reassigned).
   */
  setThreadId(threadId: string): void {
    this.threadId = threadId;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Split ANSI-stripped text into command (first line) and output (rest).
 * Handles the common case where shell echo shows "$ command" on first line.
 */
function splitCommandOutput(text: string): {
  command: string;
  output: string;
} {
  const lines = text.split("\n");
  let commandLine = lines[0] || "";

  // Strip common shell prompt prefixes
  commandLine = commandLine.replace(/^[$%#>]\s*/, "").trim();

  return {
    command: commandLine,
    output: lines.slice(1).join("\n"),
  };
}

// ─── Sentinel Injection ─────────────────────────────────────────────

/**
 * Generate the shell commands to inject the Titan sentinel marker.
 * Returns a string to write to the PTY immediately after spawn.
 */
export function getSentinelInjection(shell: string): string {
  // Detect shell type from path
  const shellName = shell.split("/").pop() || "";

  if (shellName === "fish") {
    // Fish shell uses function, not PROMPT_COMMAND
    return [
      // Define the sentinel function without echoing to terminal
      'function __titan_sentinel --on-event fish_prompt; printf "\\e]7777;TITAN_PROMPT\\a%s\\a" (pwd); end',
      "",
    ].join("\n");
  }

  if (shellName === "zsh") {
    // zsh uses precmd hook via precmd_functions array
    return [
      'function __titan_sentinel() { printf "\\033]7777;TITAN_PROMPT\\007%s\\007" "$PWD"; }',
      'precmd_functions=("${precmd_functions[@]}" __titan_sentinel)',
      "",
    ].join("\n");
  }

  // Default: bash (PROMPT_COMMAND)
  return [
    '__titan_sentinel() { printf "\\033]7777;TITAN_PROMPT\\007%s\\007" "$PWD"; }',
    'if [ -n "${PROMPT_COMMAND:-}" ]; then',
    '  PROMPT_COMMAND="${PROMPT_COMMAND};__titan_sentinel"',
    'else',
    '  PROMPT_COMMAND="__titan_sentinel"',
    'fi',
    "",
  ].join("\n");
}
