import { useCallback, useState } from "react";
import { useAppDispatch, useAppState } from "../store";
import { ProviderSettingsInline } from "./ProviderSettings";

export default function SettingsView() {
  const state = useAppState();
  const dispatch = useAppDispatch();

  const [autoRunValue, setAutoRunValue] = useState(state.autoRunCommand ?? "");
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

  const handleToggleTheme = useCallback(() => {
    dispatch({ type: "TOGGLE_THEME" });
  }, [dispatch]);

  return (
    <div className="thread-list">
      <div className="thread-list-header">
        <span className="thread-list-channel-name">Settings</span>
      </div>

      <div className="settings-body">
        <form className="settings-form" onSubmit={handleSave}>
          <div className="settings-section">
            <h3 className="settings-section-title">Theme</h3>

            <div className="settings-theme-toggle">
              <button
                type="button"
                className={`settings-theme-btn ${state.theme === "light" ? "active" : ""}`}
                onClick={handleToggleTheme}
              >
                {"\u2600"} Light
              </button>
              <button
                type="button"
                className={`settings-theme-btn ${state.theme === "dark" ? "active" : ""}`}
                onClick={handleToggleTheme}
              >
                {"\u263D"} Dark
              </button>
            </div>
          </div>

          <div className="settings-section">
            <h3 className="settings-section-title">Terminal</h3>

            <label className="settings-field">
              <span className="settings-field-label">Auto-run command</span>
              <span className="settings-field-description">
                Command to automatically execute when a new thread opens. Leave
                empty to start with a plain shell.
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

        <div className="settings-section settings-providers-section">
          <h3 className="settings-section-title">LLM Providers</h3>
          <span className="settings-field-description">
            Configure AI providers for chat threads.
          </span>
          <ProviderSettingsInline />
        </div>
      </div>
    </div>
  );
}
