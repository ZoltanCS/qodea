import { useCallback, useEffect, useState } from 'react';
import type { ProviderDraft, SaveDraft } from '../ipc.d';

const KINDS = [
  { value: 'openai-compatible', label: 'OpenAI-kompatibilis (egyéni endpoint)' },
  { value: 'azure', label: 'Azure OpenAI' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'cerebras', label: 'Cerebras' },
  { value: 'zen', label: 'OpenCode Zen' },
];

interface Draft {
  id: string;
  kind: string;
  label: string;
  baseUrl: string;
  apiKeyEnv: string;
  defaultModel: string;
  contextWindow: string;
  azureEndpoint: string;
  azureApiVersion: string;
  azureDeployment: string;
  newApiKey: string;
  clearStoredKey: boolean;
  hasStoredKey: boolean;
  isDefault: boolean;
  isNew: boolean;
}

function toDraft(p: ProviderDraft, isDefault: boolean): Draft {
  return {
    id: p.id,
    kind: p.kind,
    label: p.label ?? '',
    baseUrl: p.baseUrl ?? '',
    apiKeyEnv: p.apiKeyEnv ?? '',
    defaultModel: p.defaultModel ?? '',
    contextWindow: p.contextWindow ? String(p.contextWindow) : '',
    azureEndpoint: p.azureEndpoint ?? '',
    azureApiVersion: p.azureApiVersion ?? '',
    azureDeployment: p.azureDeployment ?? '',
    newApiKey: '',
    clearStoredKey: false,
    hasStoredKey: p.hasStoredKey,
    isDefault,
    isNew: false,
  };
}

function blankDraft(): Draft {
  return {
    id: '',
    kind: 'openai-compatible',
    label: '',
    baseUrl: '',
    apiKeyEnv: '',
    defaultModel: '',
    contextWindow: '',
    azureEndpoint: '',
    azureApiVersion: '2024-10-21',
    azureDeployment: '',
    newApiKey: '',
    clearStoredKey: false,
    hasStoredKey: false,
    isDefault: false,
    isNew: true,
  };
}

export function Settings({ onClose, compact = false }: { onClose: () => void; compact?: boolean }) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [models, setModels] = useState<string[] | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    void window.qodea
      .getConfig()
      .then((res) => {
        const ds = res.providers.map((p) => toDraft(p, p.id === res.defaultProvider));
        setDrafts(ds.length > 0 ? ds : [blankDraft()]);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  const active = drafts[activeIdx];

  const patchActive = useCallback(
    (patch: Partial<Draft>) => {
      setDrafts((prev) =>
        prev.map((d, i) => (i === activeIdx ? { ...d, ...patch } : d)),
      );
      setSavedMsg(null);
    },
    [activeIdx],
  );

  const addProvider = () => {
    setDrafts((prev) => [...prev, blankDraft()]);
    setActiveIdx(drafts.length);
    setModels(null);
  };

  const removeActive = () => {
    if (!active?.isNew && !confirm(`Törlöd a szolgáltatót: ${active?.id}?`)) return;
    setDrafts((prev) => prev.filter((_, i) => i !== activeIdx));
    setActiveIdx(0);
    setModels(null);
  };

  const loadModels = async () => {
    if (!active) return;
    setLoadingModels(true);
    setError(null);
    try {
      const res = await window.qodea.listModels({
        ...(active.isNew ? {} : { id: active.id }),
        kind: active.kind,
        ...(active.baseUrl ? { baseUrl: active.baseUrl } : {}),
        ...(active.kind === 'azure' && active.azureEndpoint
          ? { azureEndpoint: active.azureEndpoint }
          : {}),
        ...(active.newApiKey ? { newApiKey: active.newApiKey } : {}),
      });
      setModels(res.models);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setModels(null);
    } finally {
      setLoadingModels(false);
    }
  };

  const save = async () => {
    if (!active) return;
    setError(null);
    try {
      const providers: SaveDraft[] = drafts.map((d) => ({
        id: d.id.trim(),
        kind: d.kind,
        ...(d.label ? { label: d.label } : {}),
        ...(d.baseUrl ? { baseUrl: d.baseUrl.trim() } : {}),
        ...(d.apiKeyEnv ? { apiKeyEnv: d.apiKeyEnv.trim() } : {}),
        ...(d.defaultModel ? { defaultModel: d.defaultModel.trim() } : {}),
        ...(d.contextWindow ? { contextWindow: Number(d.contextWindow) } : {}),
        ...(d.kind === 'azure' && d.azureEndpoint
          ? {
              azureEndpoint: d.azureEndpoint.trim(),
              azureApiVersion: d.azureApiVersion || '2024-10-21',
              azureDeployment: d.azureDeployment || undefined,
            }
          : {}),
        ...(d.newApiKey ? { newApiKey: d.newApiKey } : {}),
        ...(d.hasStoredKey && d.clearStoredKey ? { clearStoredKey: true } : {}),
      }));

      const def = drafts.find((d) => d.isDefault);
      const res = await window.qodea.saveConfig({
        defaultProvider: def ? def.id.trim() : null,
        providers,
      });
      setSavedMsg(`Mentve: ${res.savedTo}`);
      setTimeout(onClose, 700);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (!active) return null;

  return (
    <div className={`settings${compact ? ' compact' : ''}`}>
      <header className="set-head">
        <h2>Beállítások</h2>
        <button className="icon-btn" onClick={onClose} title="Bezárás">
          ✕
        </button>
      </header>

      <div className={`set-body${compact ? ' as-col' : ''}`}>
        {/* provider list */}
        {compact ? (
          <div className="field" style={{ margin: '0 14px' }}>
            <span className="f-label">Szolgáltató</span>
            <select
              value={activeIdx}
              onChange={(e) => {
                setActiveIdx(Number(e.target.value));
                setModels(null);
              }}
            >
              {drafts.map((d, i) => (
                <option key={`${d.id}-${i}`} value={i}>
                  {d.label || d.id || '(új)'}
                </option>
              ))}
              <option value={drafts.length} disabled>
                + Új hozzáadása (nagy képernyőn)
              </option>
            </select>
          </div>
        ) : (
          <aside className="set-list">
          {drafts.map((d, i) => (
            <button
              key={`${d.id}-${i}`}
              className={`set-item${i === activeIdx ? ' on' : ''}`}
              onClick={() => {
                setActiveIdx(i);
                setModels(null);
              }}
            >
              <span className="nm">{d.label || d.id || '(új)'}</span>
              {d.isDefault && <span className="def">★</span>}
            </button>
          ))}
          <button className="set-add" onClick={addProvider}>
            + Új szolgáltató
          </button>
          </aside>
        )}

        {/* editor */}
        <section className="set-form">
          <Field label="Azonosító">
            <input
              value={active.id}
              disabled={!active.isNew}
              onChange={(e) => patchActive({ id: e.target.value })}
              placeholder="pl. azure"
            />
          </Field>

          <Field label="Típus">
            <select value={active.kind} onChange={(e) => patchActive({ kind: e.target.value })}>
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Megnevezés">
            <input
              value={active.label}
              onChange={(e) => patchActive({ label: e.target.value })}
              placeholder="pl. Azure OpenAI"
            />
          </Field>

          <Field label="Endpoint (base URL)" hint="OpenAI-kompatibilis végpont, pl. https://...azure.com/openai/v1">
            <input
              value={active.baseUrl}
              onChange={(e) => patchActive({ baseUrl: e.target.value })}
              placeholder="https://example.com/v1"
              spellCheck={false}
            />
          </Field>

          {active.kind === 'azure' && (
            <>
              <Field label="Azure endpoint (resource)">
                <input
                  value={active.azureEndpoint}
                  onChange={(e) => patchActive({ azureEndpoint: e.target.value })}
                  placeholder="https://TE-RESOURCE.openai.azure.com"
                  spellCheck={false}
                />
              </Field>
              <Field label="API version">
                <input
                  value={active.azureApiVersion}
                  onChange={(e) => patchActive({ azureApiVersion: e.target.value })}
                />
              </Field>
              <Field label="Deployment (opcionális)">
                <input
                  value={active.azureDeployment}
                  onChange={(e) => patchActive({ azureDeployment: e.target.value })}
                />
              </Field>
            </>
          )}

          <Field
            label="API kulcs"
            hint={
              active.hasStoredKey
                ? 'Van mentett kulcs — ha üresen hagyod, megmarad.'
                : undefined
            }
          >
            <input
              type="password"
              value={active.newApiKey}
              onChange={(e) => patchActive({ newApiKey: e.target.value })}
              placeholder={active.hasStoredKey ? '•••••••• (mentett)' : 'kulcs…'}
            />
          </Field>
          {active.hasStoredKey && (
            <label className="check">
              <input
                type="checkbox"
                checked={active.clearStoredKey}
                onChange={(e) => patchActive({ clearStoredKey: e.target.checked })}
              />{' '}
              mentett kulcs törlése
            </label>
          )}

          <Field label="API key env var" hint="Alternatíva: környezeti változó neve a kulcshoz">
            <input
              value={active.apiKeyEnv}
              onChange={(e) => patchActive({ apiKeyEnv: e.target.value })}
              placeholder="pl. MY_API_KEY"
              spellCheck={false}
            />
          </Field>

          <Field label="Alapértelmezett modell">
            <input
              value={active.defaultModel}
              onChange={(e) => patchActive({ defaultModel: e.target.value })}
              placeholder="pl. DeepSeek-V4-Pro"
              spellCheck={false}
            />
          </Field>

          <Field label="Context window (token)" hint="A kontextus-gyűrű ehhez mér">
            <input
              type="number"
              value={active.contextWindow}
              onChange={(e) => patchActive({ contextWindow: e.target.value })}
              placeholder="131072"
            />
          </Field>

          <button className="btn models-btn" onClick={() => void loadModels()} disabled={loadingModels}>
            {loadingModels ? 'Betöltés…' : 'Elérhető modellek lekérése'}
          </button>

          {models !== null &&
            (models.length === 0 ? (
              <div className="model-list dim">Nincs találat</div>
            ) : (
              <div className="model-list">
                {models.map((m) => (
                  <button
                    key={m}
                    className={`model${m === active.defaultModel ? ' sel' : ''}`}
                    onClick={() => patchActive({ defaultModel: m })}
                  >
                    {m}
                  </button>
                ))}
              </div>
            ))}

          <label className="check">
            <input
              type="checkbox"
              checked={active.isDefault}
              onChange={(e) =>
                setDrafts((prev) =>
                  prev.map((d, i) => ({ ...d, isDefault: i === activeIdx ? e.target.checked : false })),
                )
              }
            />{' '}
            legyen ez az alapértelmezett
          </label>

          {!active.isNew && (
            <button className="btn del" onClick={removeActive}>
              Szolgáltató törlése
            </button>
          )}
        </section>
      </div>

      <footer className="set-foot">
        {error && <span className="err">{error}</span>}
        {savedMsg && <span className="saved">{savedMsg}</span>}
        <div className="spacer" />
        <button className="btn" onClick={onClose}>
          Mégse
        </button>
        <button className="btn primary" onClick={() => void save()}>
          Mentés
        </button>
      </footer>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span className="f-label">{label}</span>
      {children}
      {hint && <span className="f-hint">{hint}</span>}
    </label>
  );
}
