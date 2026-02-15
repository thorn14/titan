import { useState, useCallback } from "react";
import { useAppState, useAppDispatch } from "../store";

export default function SettingsView() {
  const state = useAppState();
  const dispatch = useAppDispatch();

  const [autoRunValue, setAutoRunValue] = useState(
    state.autoRunCommand ?? "",
  );
  const [saved, setSaved] = useState(false);

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
      </div>
    </div>
  );
}
