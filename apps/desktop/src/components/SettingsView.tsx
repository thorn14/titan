import { useState, useCallback, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useAppState, useAppDispatch } from "../store";
import { ragStatus, ragConfigureModel } from "../rag";
import type { RagStatus } from "../rag";

export default function SettingsView() {
  const state = useAppState();
  const dispatch = useAppDispatch();

  const [autoRunValue, setAutoRunValue] = useState(
    state.autoRunCommand ?? "",
  );
  const [saved, setSaved] = useState(false);

  // RAG model configuration
  const [status, setStatus] = useState<RagStatus | null>(null);
  const [modelDir, setModelDir] = useState<string>("");
  const [modelMessage, setModelMessage] = useState<string | null>(null);

  // Load RAG status on mount
  useEffect(() => {
    ragStatus().then((s) => {
      setStatus(s);
      setModelDir(s.model_dir ?? "");
    }).catch(() => {});
  }, []);

  const handleSave = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = autoRunValue.trim();
      dispatch({
        type: "SET_AUTO_RUN_COMMAND",
        command: trimmed || null,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
    [autoRunValue, dispatch],
  );

  const handleBrowseModel = useCallback(async () => {
    const selected = await open({
      directory: true,
      title: "Select ONNX model directory (must contain model.onnx + tokenizer.json)",
    });
    if (selected) {
      setModelDir(selected);
    }
  }, []);

  const handleApplyModel = useCallback(async () => {
    setModelMessage(null);
    try {
      const dir = modelDir.trim() || null;
      const result = await ragConfigureModel(dir);
      if (result.enabled) {
        setModelMessage("Embedder enabled. Semantic search is active.");
      } else {
        setModelMessage("Embedder disabled. Only recent history lookup is available.");
      }
      // Persist the model dir setting
      try {
        if (dir) {
          localStorage.setItem("titan:ragModelDir", dir);
        } else {
          localStorage.removeItem("titan:ragModelDir");
        }
      } catch {}
      // Refresh status
      const s = await ragStatus();
      setStatus(s);
    } catch (err) {
      setModelMessage(`Error: ${err}`);
    }
  }, [modelDir]);

  const handleDisableModel = useCallback(async () => {
    setModelMessage(null);
    try {
      await ragConfigureModel(null);
      setModelDir("");
      setModelMessage("Semantic search disabled.");
      try {
        localStorage.removeItem("titan:ragModelDir");
      } catch {}
      const s = await ragStatus();
      setStatus(s);
    } catch (err) {
      setModelMessage(`Error: ${err}`);
    }
  }, []);

  return (
    <div className="thread-list">
      <div className="thread-list-header">
        <span className="thread-list-channel-name">Settings</span>
      </div>

      <div className="settings-body">
        <form className="settings-form" onSubmit={handleSave}>
          <div className="settings-section">
            <h3 className="settings-section-title">Terminal</h3>

            <label className="settings-field">
              <span className="settings-field-label">Auto-run command</span>
              <span className="settings-field-description">
                Command to automatically execute when a new thread opens.
                Leave empty to start with a plain shell.
              </span>
              <input
                className="settings-input"
                type="text"
                value={autoRunValue}
                onChange={(e) => setAutoRunValue(e.target.value)}
                placeholder="e.g. claude, cursor, aider"
              />
            </label>
          </div>

          <div className="settings-actions">
            <button type="submit" className="settings-save-btn">
              {saved ? "Saved" : "Save"}
            </button>
          </div>
        </form>

        <div className="settings-section settings-section-rag">
          <h3 className="settings-section-title">Terminal History Search</h3>

          <div className="settings-field">
            <span className="settings-field-label">Embedding model</span>
            <span className="settings-field-description">
              Directory containing an ONNX sentence-transformer model
              (model.onnx + tokenizer.json). Required for semantic search.
              Leave empty to disable — terminal history will still be
              stored and searchable by recency.
            </span>
            <div className="settings-model-row">
              <input
                className="settings-input"
                type="text"
                value={modelDir}
                onChange={(e) => setModelDir(e.target.value)}
                placeholder="Path to model directory (e.g. all-MiniLM-L6-v2)"
              />
              <button
                type="button"
                className="settings-browse-btn"
                onClick={handleBrowseModel}
              >
                Browse
              </button>
            </div>
            <div className="settings-model-actions">
              <button
                type="button"
                className="settings-save-btn"
                onClick={handleApplyModel}
              >
                Apply
              </button>
              <button
                type="button"
                className="settings-disable-btn"
                onClick={handleDisableModel}
              >
                Disable
              </button>
            </div>
            {modelMessage && (
              <span className="settings-model-message">{modelMessage}</span>
            )}
          </div>

          {status && (
            <div className="settings-rag-status">
              <div className="settings-status-row">
                <span className="settings-status-label">Database:</span>
                <span className={`settings-status-value ${status.db_available ? "ok" : "err"}`}>
                  {status.db_available ? "Active" : "Not available"}
                </span>
              </div>
              <div className="settings-status-row">
                <span className="settings-status-label">Semantic search:</span>
                <span className={`settings-status-value ${status.embedder_available ? "ok" : "err"}`}>
                  {status.embedder_available ? "Active" : "Disabled"}
                </span>
              </div>
              <div className="settings-status-row">
                <span className="settings-status-label">DB path:</span>
                <span className="settings-status-value path">{status.db_path}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
