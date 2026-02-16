import { useState, useCallback, useRef, useEffect } from "react";
import { ragSearch, ragRecent, ragGet, ragStatus } from "../rag";
import type { SearchResult, FullChunk, RagStatus } from "../rag";
import { useAppState, useAppDispatch } from "../store";

function formatTimestamp(ts: number): string {
  const date = new Date(ts * 1000);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return `${str.slice(0, maxLen)}...`;
}

export default function PtySearch() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [fullOutput, setFullOutput] = useState<FullChunk | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"search" | "recent">("recent");
  const [status, setStatus] = useState<RagStatus | null>(null);
  const [threadFilter, setThreadFilter] = useState<string | "all">("all");

  // Load RAG status on mount
  useEffect(() => {
    ragStatus()
      .then(setStatus)
      .catch(() => {});
  }, []);

  // Load recent on mount
  useEffect(() => {
    loadRecent();
  }, []);

  const loadRecent = useCallback(async () => {
    setLoading(true);
    try {
      const tid = threadFilter === "all" ? undefined : threadFilter;
      const recent = await ragRecent(20, tid);
      setResults(recent);
      setMode("recent");
    } catch (err) {
      console.error("[pty-search] Failed to load recent:", err);
    } finally {
      setLoading(false);
    }
  }, [threadFilter]);

  const handleSearch = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        loadRecent();
        return;
      }

      setLoading(true);
      setMode("search");
      try {
        const tid = threadFilter === "all" ? undefined : threadFilter;
        const searchResults = await ragSearch(q, 20, tid);
        setResults(searchResults);
      } catch (err) {
        console.error("[pty-search] Search failed:", err);
      } finally {
        setLoading(false);
      }
    },
    [threadFilter, loadRecent],
  );

  const handleExpand = useCallback(
    async (id: number) => {
      if (expandedId === id) {
        setExpandedId(null);
        setFullOutput(null);
        return;
      }
      setExpandedId(id);
      setFullOutput(null);
      try {
        const chunk = await ragGet(id);
        setFullOutput(chunk);
      } catch (err) {
        console.error("[pty-search] Failed to get chunk:", err);
      }
    },
    [expandedId],
  );

  const handleNavigateToThread = useCallback(
    (threadId: string) => {
      dispatch({ type: "SELECT_THREAD", threadId });
    },
    [dispatch],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleSearch(query);
      }
    },
    [query, handleSearch],
  );

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const dbAvailable = status?.db_available ?? false;

  return (
    <div className="pty-search-panel">
      <div className="pty-search-header">
        <h3 className="pty-search-title">Terminal History</h3>
        {status && (
          <div className="pty-search-status">
            <span
              className={`pty-search-status-dot ${dbAvailable ? "available" : ""}`}
            />
            <span className="pty-search-status-text">
              {dbAvailable
                ? status.embedder_available
                  ? "Semantic search"
                  : "Storage only"
                : "Not available"}
            </span>
          </div>
        )}
      </div>

      <div className="pty-search-controls">
        <div className="pty-search-input-row">
          <input
            ref={inputRef}
            className="pty-search-input"
            type="text"
            placeholder="Search terminal history..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            type="button"
            className="pty-search-btn"
            onClick={() => handleSearch(query)}
            disabled={loading}
          >
            {loading ? "..." : "Search"}
          </button>
        </div>
        <div className="pty-search-filters">
          <button
            type="button"
            className={`pty-search-tab ${mode === "recent" && !query ? "active" : ""}`}
            onClick={() => {
              setQuery("");
              loadRecent();
            }}
          >
            Recent
          </button>
          <select
            className="pty-search-thread-filter"
            value={threadFilter}
            onChange={(e) => setThreadFilter(e.target.value)}
          >
            <option value="all">All threads</option>
            {state.threads.map((t) => (
              <option key={t.id} value={t.id}>
                {truncate(t.title, 30)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="pty-search-results">
        {!dbAvailable && (
          <div className="pty-search-empty">
            RAG database not available. Terminal output will be indexed once the
            database is initialized.
          </div>
        )}

        {dbAvailable && results.length === 0 && !loading && (
          <div className="pty-search-empty">
            {mode === "search"
              ? "No results found."
              : "No terminal history yet. Commands will appear here as you use the terminal."}
          </div>
        )}

        {results.map((r) => (
          <div key={r.id} className="pty-search-result">
            <div
              className="pty-search-result-header"
              onClick={() => handleExpand(r.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleExpand(r.id);
              }}
              role="button"
              tabIndex={0}
            >
              <div className="pty-search-result-command">
                <span className="pty-search-prompt">$</span>
                <span className="pty-search-command-text">
                  {truncate(r.command, 100)}
                </span>
              </div>
              <div className="pty-search-result-meta">
                {r.distance != null && (
                  <span className="pty-search-relevance">
                    {Math.round((1 - r.distance) * 100)}%
                  </span>
                )}
                <span className="pty-search-timestamp">
                  {formatTimestamp(r.timestamp)}
                </span>
                {r.cwd && (
                  <span className="pty-search-cwd" title={r.cwd}>
                    {r.cwd.split("/").pop()}
                  </span>
                )}
              </div>
            </div>

            {r.output_preview && (
              <div className="pty-search-result-preview">
                {truncate(r.output_preview, 200)}
              </div>
            )}

            {expandedId === r.id && fullOutput && (
              <div className="pty-search-result-full">
                <pre className="pty-search-output">{fullOutput.output}</pre>
                <button
                  type="button"
                  className="pty-search-goto-btn"
                  onClick={() => handleNavigateToThread(r.thread_id)}
                >
                  Go to thread
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
