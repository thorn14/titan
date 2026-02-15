import { useCallback, useState } from "react";
import { useAppDispatch, useAppState } from "../store";
import type { ProviderConfig } from "../types";

type ProviderType = ProviderConfig["type"];

const PROVIDER_TYPE_LABELS: Record<ProviderType, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  ollama: "Ollama (OpenAI-compatible)",
};

const PROVIDER_DEFAULTS: Record<
  ProviderType,
  { baseUrl: string; defaultModel: string; needsKey: boolean }
> = {
  openai: {
    baseUrl: "",
    defaultModel: "gpt-4o",
    needsKey: true,
  },
  anthropic: {
    baseUrl: "",
    defaultModel: "claude-sonnet-4-5-20250514",
    needsKey: true,
  },
  ollama: {
    baseUrl: "http://localhost:11434/v1",
    defaultModel: "llama3.2",
    needsKey: false,
  },
};

function ProviderForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: ProviderConfig;
  onSave: (config: ProviderConfig) => void;
  onCancel: () => void;
}) {
  const [providerType, setProviderType] = useState<ProviderType>(
    initial?.type ?? "ollama",
  );
  const [label, setLabel] = useState(initial?.label ?? "");
  const [baseUrl, setBaseUrl] = useState(
    initial?.baseUrl ?? PROVIDER_DEFAULTS[initial?.type ?? "ollama"].baseUrl,
  );
  const [apiKey, setApiKey] = useState(initial?.apiKey ?? "");
  const [defaultModel, setDefaultModel] = useState(
    initial?.defaultModel ??
      PROVIDER_DEFAULTS[initial?.type ?? "ollama"].defaultModel,
  );

  const handleTypeChange = (type: ProviderType) => {
    setProviderType(type);
    const defaults = PROVIDER_DEFAULTS[type];
    if (!initial) {
      setBaseUrl(defaults.baseUrl);
      setDefaultModel(defaults.defaultModel);
      setLabel(PROVIDER_TYPE_LABELS[type]);
    }
  };

  const handleSubmit = () => {
    const config: ProviderConfig = {
      id: initial?.id ?? `provider-${Date.now()}`,
      type: providerType,
      label: label || PROVIDER_TYPE_LABELS[providerType],
      baseUrl: baseUrl || undefined,
      apiKey: apiKey || undefined,
      defaultModel,
    };
    onSave(config);
  };

  const defaults = PROVIDER_DEFAULTS[providerType];

  return (
    <div className="provider-form">
      <label className="provider-form-field">
        <span className="provider-form-label">Provider Type</span>
        <select
          className="provider-form-select"
          value={providerType}
          onChange={(e) => handleTypeChange(e.target.value as ProviderType)}
        >
          {(Object.keys(PROVIDER_TYPE_LABELS) as ProviderType[]).map((t) => (
            <option key={t} value={t}>
              {PROVIDER_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </label>

      <label className="provider-form-field">
        <span className="provider-form-label">Label</span>
        <input
          className="provider-form-input"
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={PROVIDER_TYPE_LABELS[providerType]}
        />
      </label>

      <label className="provider-form-field">
        <span className="provider-form-label">Base URL</span>
        <input
          className="provider-form-input"
          type="text"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder={defaults.baseUrl || "Default"}
        />
      </label>

      {defaults.needsKey && (
        <label className="provider-form-field">
          <span className="provider-form-label">API Key</span>
          <input
            className="provider-form-input"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
          />
        </label>
      )}

      <label className="provider-form-field">
        <span className="provider-form-label">Default Model</span>
        <input
          className="provider-form-input"
          type="text"
          value={defaultModel}
          onChange={(e) => setDefaultModel(e.target.value)}
          placeholder={defaults.defaultModel}
        />
      </label>

      <div className="provider-form-actions">
        <button
          type="button"
          className="provider-btn-secondary"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="provider-btn-primary"
          onClick={handleSubmit}
        >
          {initial ? "Save" : "Add Provider"}
        </button>
      </div>
    </div>
  );
}

export function ProviderSettingsInline() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  const handleAdd = useCallback(
    (config: ProviderConfig) => {
      dispatch({ type: "ADD_PROVIDER", provider: config });
      setShowAddForm(false);
    },
    [dispatch],
  );

  const handleUpdate = useCallback(
    (config: ProviderConfig) => {
      dispatch({ type: "UPDATE_PROVIDER", provider: config });
      setEditingId(null);
    },
    [dispatch],
  );

  const handleRemove = useCallback(
    (id: string) => {
      dispatch({ type: "REMOVE_PROVIDER", providerId: id });
    },
    [dispatch],
  );

  const handleSetDefault = useCallback(
    (id: string) => {
      dispatch({ type: "SET_DEFAULT_PROVIDER", providerId: id });
    },
    [dispatch],
  );

  return (
    <div className="provider-list">
      {state.providers.length === 0 && !showAddForm && (
        <div className="provider-empty">
          No providers configured. Add one to start using chat.
        </div>
      )}

      {state.providers.map((provider) => (
        <div key={provider.id} className="provider-card">
          {editingId === provider.id ? (
            <ProviderForm
              initial={provider}
              onSave={handleUpdate}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <div className="provider-card-row">
              <div className="provider-card-info">
                <div className="provider-card-label">
                  {provider.label}
                  {provider.id === state.defaultProviderId && (
                    <span className="provider-default-badge">Default</span>
                  )}
                </div>
                <div className="provider-card-meta">
                  {PROVIDER_TYPE_LABELS[provider.type]} &middot;{" "}
                  {provider.defaultModel}
                </div>
              </div>
              <div className="provider-card-actions">
                {provider.id !== state.defaultProviderId && (
                  <button
                    type="button"
                    className="provider-btn-text"
                    onClick={() => handleSetDefault(provider.id)}
                  >
                    Set default
                  </button>
                )}
                <button
                  type="button"
                  className="provider-btn-text"
                  onClick={() => setEditingId(provider.id)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="provider-btn-text provider-btn-danger"
                  onClick={() => handleRemove(provider.id)}
                >
                  Remove
                </button>
              </div>
            </div>
          )}
        </div>
      ))}

      {showAddForm ? (
        <div className="provider-card">
          <ProviderForm
            onSave={handleAdd}
            onCancel={() => setShowAddForm(false)}
          />
        </div>
      ) : (
        <button
          type="button"
          className="provider-add-btn"
          onClick={() => setShowAddForm(true)}
        >
          + Add Provider
        </button>
      )}
    </div>
  );
}
