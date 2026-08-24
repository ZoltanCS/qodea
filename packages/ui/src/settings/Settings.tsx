import { useCallback, useEffect, useState } from 'react';
import type { ProviderDraft, SaveDraft } from '../ipc.d';
import type { PermissionMode } from '@qodea/core';
import { QodeaBot } from '../mascot/QodeaBot';
import { Avatar } from '../avatar/Avatar';
import type { AvatarCfg } from '../avatar/avatarConfig';
import { Icon, type IconName } from '../ui/Icon';
import { loadPrefs, savePrefs } from '../chat/prefs';

const KINDS = [
  { value: 'openai-compatible', label: 'OpenAI-kompatibilis (egyéni endpoint)' },
  { value: 'azure', label: 'Azure OpenAI' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'cerebras', label: 'Cerebras' },
  { value: 'zen', label: 'OpenCode Zen' },
];

type TabId =
  | 'general'
  | 'providers'
  | 'agents'
  | 'skills'
  | 'plugins'
  | 'integrations'
  | 'themes'
  | 'about';

interface TabDef {
  id: TabId;
  icon: IconName;
  label: string;
  soon?: boolean;
}

const TABS: TabDef[] = [
  { id: 'general', icon: 'general', label: 'Általános' },
  { id: 'providers', icon: 'providers', label: 'Szolgáltatók' },
  { id: 'agents', icon: 'agents', label: 'Agentek' },
  { id: 'skills', icon: 'skills', label: 'Skillek', soon: true },
  { id: 'plugins', icon: 'plugins', label: 'Pluginek', soon: true },
  { id: 'integrations', icon: 'integrations', label: 'Integrációk', soon: true },
  { id: 'themes', icon: 'themes', label: 'Témák', soon: true },
  { id: 'about', icon: 'about', label: 'Névjegy' },
];

/* ── provider drafts ──────────────────────────────────────────────────────── */

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

/* ── main component ──────────────────────────────────────────────────────── */

export function Settings({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<TabId>('providers');

  // providers
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [models, setModels] = useState<string[] | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  // agents
  const [agentCards, setAgentCards] = useState<AgentCard[]>([]);
  const [defaultProvider, setDefaultProvider] = useState<string | null>(null);

  useEffect(() => {
    void window.qodea
      .getConfig()
      .then((res) => {
        const ds = res.providers.map((p) => toDraft(p, p.id === res.defaultProvider));
        setDrafts(ds.length > 0 ? ds : [blankDraft()]);
        setAgentCards(
          res.agents.map((a) => ({
            id: a.id,
            name: a.name,
            color: a.color ?? '#9aa0a6',
            face: a.face ?? 'neutral',
            tools: a.tools ?? [],
            prompt: a.prompt ?? '',
            model: a.model ?? '',
            isBuiltin: a.isBuiltin ?? true,
          })),
        );
        setDefaultProvider(res.defaultProvider);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  const active = drafts[activeIdx];

  const patchActive = useCallback(
    (patch: Partial<Draft>) => {
      setDrafts((prev) => prev.map((d, i) => (i === activeIdx ? { ...d, ...patch } : d)));
      setSavedMsg(null);
    },
    [activeIdx],
  );

  const setActive = useCallback((i: number) => {
    setActiveIdx(i);
    setModels(null);
  }, []);

  const addProvider = useCallback(() => {
    setDrafts((prev) => [...prev, blankDraft()]);
    setActiveIdx(drafts.length);
    setModels(null);
  }, [drafts.length]);

  const removeActive = useCallback(() => {
    if (!active?.isNew && !confirm(`Törlöd a szolgáltatót: ${active?.id}?`)) return;
    setDrafts((prev) => prev.filter((_, i) => i !== activeIdx));
    setActiveIdx(0);
    setModels(null);
  }, [active]);

  const markDefault = useCallback(
    (checked: boolean) => {
      setDrafts((prev) => prev.map((d, i) => ({ ...d, isDefault: i === activeIdx ? checked : false })));
    },
    [activeIdx],
  );

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

  const saveProviders = async (): Promise<boolean> => {
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
        agents: agentCards.map((a) => ({
          id: a.id.trim(),
          name: a.name.trim(),
          color: a.color,
          face: a.face,
          tools: a.tools,
          prompt: a.prompt,
          ...(a.model.trim() ? { model: a.model.trim() } : {}),
        })),
      });
      setSavedMsg(`Mentve: ${res.savedTo}`);
      setTimeout(() => setSavedMsg(null), 2500);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  };

  return (
    <div className="settings hub">
      <header className="set-head">
        <h2>Beállítások</h2>
        <button className="icon-btn" onClick={onClose} title="Bezárás">
          ✕
        </button>
      </header>

      <div className="hub-body">
        {/* category rail */}
        <nav className="cat-rail">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`cat-item${tab === t.id ? ' on' : ''}`}
              onClick={() => setTab(t.id)}
            >
              <span className="ic"><Icon name={t.icon} size={15} /></span>
              <span className="lbl">{t.label}</span>
              {t.soon && <span className="soon">hamarosan</span>}
            </button>
          ))}
        </nav>

        {/* content pane */}
        <section className="hub-pane">
          {error && (
            <div className="banner" style={{ marginBottom: 12 }}>
              {error}
            </div>
          )}

          {tab === 'providers' &&
            (active ? (
              <ProvidersEditor
                drafts={drafts}
                activeIdx={activeIdx}
                setActive={setActive}
                patchActive={patchActive}
                addProvider={addProvider}
                removeActive={removeActive}
                markDefault={markDefault}
                loadModels={() => void loadModels()}
                loadingModels={loadingModels}
                models={models}
                savedMsg={savedMsg}
                onSave={() => void saveProviders()}
              />
            ) : (
              <div className="dim pad">Betöltés…</div>
            ))}

          {tab === 'agents' && (
            <AgentsTab
              agents={agentCards}
              setAgents={setAgentCards}
              onSave={() => void saveProviders()}
              defaultProvider={defaultProvider}
            />
          )}

          {tab === 'general' && (
            <Placeholder
              title="Általános"
              note="Nyelv, indítási viselkedés, automatikus frissítések és telemetria ide kerül. A világos/sötét téma váltó egyelőre a sidebar alján lévő téma-gombbal érhető el."
            />
          )}

          {TABS.filter((t) => t.soon)
            .filter((t) => t.id === tab)
            .map((t) => (
              <Placeholder
                key={t.id}
                title={t.label}
                soon
                note={
                  t.id === 'skills'
                    ? 'SKILL.md alapú képesség-csomagok: globális és projektszintű, automatikus aktiválással.'
                    : t.id === 'plugins'
                      ? 'Harmadik féltől származó bővítmények és egyéni toolok telepítése.'
                      : t.id === 'integrations'
                        ? 'MCP szerverek, GitHub, böngésző-híd és külső szolgáltatások kapcsolása.'
                        : 'Sajátítható témák, testreszabható megjelenés és ikon-csomagok.'
                }
              />
            ))}

          {tab === 'about' && <AboutTab />}
        </section>
      </div>
    </div>
  );
}

/* ── Providers tab ───────────────────────────────────────────────────────── */

function ProvidersEditor(props: {
  drafts: Draft[];
  activeIdx: number;
  setActive: (i: number) => void;
  patchActive: (p: Partial<Draft>) => void;
  addProvider: () => void;
  removeActive: () => void;
  markDefault: (v: boolean) => void;
  loadModels: () => void;
  loadingModels: boolean;
  models: string[] | null;
  savedMsg: string | null;
  onSave: () => void;
}) {
  const active = props.drafts[props.activeIdx];
  if (!active) return <div className="dim pad">Nincs szolgáltató.</div>;

  return (
    <div className="prov-split">
      <aside className="set-list">
        {props.drafts.map((d, i) => (
          <button
            key={`${d.id}-${i}`}
            className={`set-item${i === props.activeIdx ? ' on' : ''}`}
            onClick={() => props.setActive(i)}
          >
            <span className="nm">{d.label || d.id || '(új)'}</span>
            {d.isDefault && <span className="def">★</span>}
          </button>
        ))}
        <button className="set-add" onClick={props.addProvider}>
          + Új szolgáltató
        </button>
      </aside>

      <section className="set-form">
        <Field label="Azonosító">
          <input
            value={active.id}
            disabled={!active.isNew}
            onChange={(e) => props.patchActive({ id: e.target.value })}
            placeholder="pl. azure"
          />
        </Field>

        <Field label="Típus">
          <select value={active.kind} onChange={(e) => props.patchActive({ kind: e.target.value })}>
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
            onChange={(e) => props.patchActive({ label: e.target.value })}
            placeholder="pl. Azure OpenAI"
          />
        </Field>

        <Field label="Endpoint (base URL)" hint="pl. https://...azure.com/openai/v1">
          <input
            value={active.baseUrl}
            onChange={(e) => props.patchActive({ baseUrl: e.target.value })}
            placeholder="https://example.com/v1"
            spellCheck={false}
          />
        </Field>

        {active.kind === 'azure' && (
          <>
            <Field label="Azure endpoint (resource)">
              <input
                value={active.azureEndpoint}
                onChange={(e) => props.patchActive({ azureEndpoint: e.target.value })}
                placeholder="https://TE-RESOURCE.openai.azure.com"
                spellCheck={false}
              />
            </Field>
            <Field label="API version">
              <input
                value={active.azureApiVersion}
                onChange={(e) => props.patchActive({ azureApiVersion: e.target.value })}
              />
            </Field>
            <Field label="Deployment (opcionális)">
              <input
                value={active.azureDeployment}
                onChange={(e) => props.patchActive({ azureDeployment: e.target.value })}
              />
            </Field>
          </>
        )}

        <Field
          label="API kulcs"
          hint={active.hasStoredKey ? 'Van mentett kulcs — ha üresen hagyod, megmarad.' : undefined}
        >
          <input
            type="password"
            value={active.newApiKey}
            onChange={(e) => props.patchActive({ newApiKey: e.target.value })}
            placeholder={active.hasStoredKey ? '•••••••• (mentett)' : 'kulcs…'}
          />
        </Field>
        {active.hasStoredKey && (
          <label className="check">
            <input
              type="checkbox"
              checked={active.clearStoredKey}
              onChange={(e) => props.patchActive({ clearStoredKey: e.target.checked })}
            />{' '}
            mentett kulcs törlése
          </label>
        )}

        <Field label="API key env var" hint="Alternatíva: környezeti változó neve a kulcshoz">
          <input
            value={active.apiKeyEnv}
            onChange={(e) => props.patchActive({ apiKeyEnv: e.target.value })}
            placeholder="pl. MY_API_KEY"
            spellCheck={false}
          />
        </Field>

        <Field label="Alapértelmezett modell">
          <input
            value={active.defaultModel}
            onChange={(e) => props.patchActive({ defaultModel: e.target.value })}
            placeholder="pl. DeepSeek-V4-Pro"
            spellCheck={false}
          />
        </Field>

        <Field label="Context window (token)" hint="A kontextus-gyűrű ehhez mér">
          <input
            type="number"
            value={active.contextWindow}
            onChange={(e) => props.patchActive({ contextWindow: e.target.value })}
            placeholder="131072"
          />
        </Field>

        <button className="btn models-btn" onClick={props.loadModels} disabled={props.loadingModels}>
          {props.loadingModels ? 'Betöltés…' : 'Elérhető modellek lekérése'}
        </button>

        {props.models !== null &&
          (props.models.length === 0 ? (
            <div className="model-list dim">Nincs találat</div>
          ) : (
            <div className="model-list">
              {props.models.map((m) => (
                <button
                  key={m}
                  className={`model${m === active.defaultModel ? ' sel' : ''}`}
                  onClick={() => props.patchActive({ defaultModel: m })}
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
            onChange={(e) => props.markDefault(e.target.checked)}
          />{' '}
          legyen ez az alapértelmezett
        </label>

        {!active.isNew && (
          <button className="btn del" onClick={props.removeActive}>
            Szolgáltató törlése
          </button>
        )}

        <div className="pane-actions">
          {props.savedMsg && <span className="saved">{props.savedMsg}</span>}
          <span className="spacer" />
          <button className="btn primary" onClick={props.onSave}>
            Mentés
          </button>
        </div>
      </section>
    </div>
  );
}

/* ── Agents tab: card grid + full editor ─────────────────────────────────── */

const ALL_TOOLS = [
  'read_file', 'write_file', 'edit_file', 'glob_files', 'grep_files', 'bash',
  'todo_write', 'web_search', 'web_fetch', 'browser_navigate', 'browser_snapshot',
  'browser_click', 'browser_type', 'browser_scroll', 'browser_screenshot', 'browser_close',
];

const FACE_OPTIONS = [
  'neutral', 'attentive', 'surprised', 'excited', 'happy', 'laughing', 'angry',
  'sad', 'scared', 'suspicious', 'confused', 'curious', 'proud', 'shy',
  'unimpressed', 'sleepy',
];

const AGENT_COLORS = [
  '#3d8bfd', '#3fae6a', '#f08b1f', '#8a63e8', '#e2503c',
  '#39b8a0', '#e05fc0', '#eec93d', '#9aa0a6', '#f4f2ec',
];

interface AgentCard {
  id: string;
  name: string;
  color: string;
  face: string;
  tools: string[];
  prompt: string;
  model: string;
  isBuiltin: boolean;
}

function AgentsTab({
  agents,
  setAgents,
  onSave,
  defaultProvider,
}: {
  agents: AgentCard[];
  setAgents: (a: AgentCard[]) => void;
  onSave: () => void;
  defaultProvider: string | null;
}) {
  const [selIdx, setSelIdx] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sel = selIdx !== null ? agents[selIdx] : null;

  const patch = (p: Partial<AgentCard>) => {
    if (selIdx === null) return;
    setAgents(agents.map((a, i) => (i === selIdx ? { ...a, ...p } : a)));
  };

  const addAgent = () => {
    const id = `custom-${Date.now().toString(36)}`;
    setAgents([
      ...agents,
      {
        id,
        name: 'Új agent',
        color: AGENT_COLORS[agents.length % AGENT_COLORS.length]!,
        face: 'neutral',
        tools: ['read_file', 'glob_files', 'grep_files'],
        prompt: '',
        model: '',
        isBuiltin: false,
      },
    ]);
    setSelIdx(agents.length);
  };

  const removeAgent = () => {
    if (selIdx === null) return;
    setAgents(agents.filter((_, i) => i !== selIdx));
    setSelIdx(null);
  };

  return (
    <div className="agents-config">
      <div className="ac-grid">
        {agents.map((a, i) => (
          <button
            key={a.id}
            className={`ac-card${i === selIdx ? ' on' : ''}`}
            onClick={() => setSelIdx(i)}
          >
            <Avatar
              cfg={{ shape: 'circle', face: (a.face as AvatarCfg['face']) ?? 'neutral', color: a.color }}
              size={38}
              animate
            />
            <span className="ac-txt">
              <span className="ac-name">{a.name}</span>
              <span className="ac-role">
                {a.tools.length} tool{a.model ? ` · ${a.model}` : ''}
                {a.isBuiltin ? ' · beépített' : ' · saját'}
              </span>
            </span>
          </button>
        ))}
        <button className="ac-card ac-plus" onClick={addAgent}>
          + Új agent
        </button>
      </div>

      {sel && (
        <div className="ac-form">
          <Field label="Azonosító">
            <input value={sel.id} disabled={sel.isBuiltin} onChange={(e) => patch({ id: e.target.value })} />
          </Field>

          <Field label="Név">
            <input value={sel.name} onChange={(e) => patch({ name: e.target.value })} />
          </Field>

          <Field label="Szín">
            <div className="swatches" style={{ gridTemplateColumns: 'repeat(10, 1fr)' }}>
              {AGENT_COLORS.map((c) => (
                <button
                  key={c}
                  className={`swatch${sel.color === c ? ' on' : ''}`}
                  style={{ background: c, width: 28, height: 28 }}
                  onClick={() => patch({ color: c })}
                />
              ))}
            </div>
          </Field>

          <Field label="Arc">
            <select value={sel.face} onChange={(e) => patch({ face: e.target.value })}>
              {FACE_OPTIONS.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </Field>

          <Field label="Modell (üres = alapértelmezett)">
            <input
              value={sel.model}
              onChange={(e) => patch({ model: e.target.value })}
              placeholder={defaultProvider ?? 'modell neve'}
            />
          </Field>

          <Field label="Rendszerprompt" hint="Kiegészíti az alap promptot — személyiség, szabályok, fókusz.">
            <textarea
              value={sel.prompt}
              onChange={(e) => patch({ prompt: e.target.value })}
              placeholder="Te vagy X, a … specialista. …"
            />
          </Field>

          <Field label="Engedélyezett toolok">
            <div className="tools-checks">
              {ALL_TOOLS.map((t) => (
                <button
                  key={t}
                  className={`tool-check${sel.tools.includes(t) ? ' on' : ''}`}
                  onClick={() =>
                    patch({
                      tools: sel.tools.includes(t)
                        ? sel.tools.filter((x) => x !== t)
                        : [...sel.tools, t],
                    })
                  }
                >
                  {t}
                </button>
              ))}
            </div>
          </Field>

          {!sel.isBuiltin && (
            <button className="btn del" onClick={removeAgent}>
              Agent törlése
            </button>
          )}
          {sel.isBuiltin && (
            <p className="f-hint">Beépített agent — a módosítások felülírják az alapértelmezéseit.</p>
          )}

          <div className="pane-actions">
            {error && <span className="err" style={{ color: '#e2705a', fontSize: 12 }}>{error}</span>}
            <span className="spacer" />
            <button
              className="btn primary"
              onClick={() => {
                if (!sel.id.trim() || !sel.name.trim()) {
                  setError('Az azonosító és a név kötelező.');
                  return;
                }
                setError(null);
                onSave();
              }}
            >
              Mentés
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── About tab ───────────────────────────────────────────────────────────── */

function AboutTab() {
  return (
    <div className="about">
      <QodeaBot mood="idle" color="cream" size={84} />
      <h3>Qodea</h3>
      <p className="dim">v0.3.0-dev · multi-agent útján</p>
      <p className="dim small">
        Nyílt forráskódú agentic coder app — több agent, skill-ek, böngésző-vezérlés,
        tervezés. TypeScript + Electron + provider-független agent core.
      </p>
      <code className="dim small">github.com/ZoltanCS/qodea</code>
      <p className="dim small">Licenc: MIT © 2026 Csala Zoltán</p>
    </div>
  );
}

/* ── placeholder panel ───────────────────────────────────────────────────── */

function Placeholder({ title, note, soon }: { title: string; note: string; soon?: boolean }) {
  return (
    <div className="soon-panel">
      <h3>{title}</h3>
      <p className="dim">{note}</p>
      {soon && <span className="badge">Hamarosan</span>}
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
