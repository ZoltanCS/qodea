import { useCallback, useEffect, useRef, useState } from 'react';
import { QodeaBot, type BotMood } from './mascot/QodeaBot';
import { useChatSession, MODES, EFFORTS } from './chat/useChatSession';
import { Row } from './chat/messageViews';
import { Sidebar } from './sidebar/Sidebar';
import { Settings } from './settings/Settings';
import { AgentPanel } from './panels/AgentPanel';
import { AvatarEditor } from './avatar/AvatarEditor';
import { loadAvatar, saveAvatar, type AvatarCfg } from './avatar/avatarConfig';
import type { LifetimeStats } from './ipc.d';
import { estimateCost } from './ui/pricing';

type Theme = 'dark' | 'light';

function initialTheme(): Theme {
  return localStorage.getItem('qodea-theme') === 'light' ? 'light' : 'dark';
}

function projectNameOf(cwd: string): string {
  const norm = cwd.replace(/[\\/]+$/, '');
  return norm.split(/[\\/]/).pop() || norm;
}

export function App() {
  const chat = useChatSession();
  const [draft, setDraft] = useState('');
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [showSettings, setShowSettings] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [avatarCfg, setAvatarCfg] = useState<AvatarCfg>(loadAvatar);
  const [lifetime, setLifetime] = useState<LifetimeStats | null>(null);
  const [projectCount, setProjectCount] = useState(0);
  const streamRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
    localStorage.setItem('qodea-theme', theme);
  }, [theme]);

  useEffect(() => {
    void window.qodea.statsGet().then(setLifetime).catch(() => {});
    void window.qodea
      .projectsList()
      .then((p) => setProjectCount(p.length))
      .catch(() => {});
  }, []);

  const submit = useCallback(() => {
    if (!draft.trim()) return;
    const task = draft;
    setDraft('');
    void chat.send(task);
  }, [draft, chat]);

  // smart autoscroll: follow the stream only while the user is near the bottom
  useEffect(() => {
    const el = streamRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [chat.items]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const running = chat.status === 'running';
  const showHome = !running && chat.items.length === 0 && !chat.activeSessionId;

  // hero mascot random micro-animations — the little guy keeps himself busy
  const [heroMood, setHeroMood] = useState<BotMood>('idle');
  useEffect(() => {
    if (!showHome) return;
    let timer: ReturnType<typeof setTimeout>;
    const fire = () => {
      const opts: BotMood[] = ['working', 'waiting', 'thinking', 'working'];
      setHeroMood(opts[Math.floor(Math.random() * opts.length)]!);
      setTimeout(() => setHeroMood('idle'), 1500);
      timer = setTimeout(fire, 6000 + Math.random() * 9000);
    };
    timer = setTimeout(fire, 4000 + Math.random() * 4000);
    return () => clearTimeout(timer);
  }, [showHome]);
  const runningAgents = chat.deployedAgents.filter((a) => a.status === 'running').length;

  const projectLabel = (() => {
    if (!chat.cwd.trim()) return 'Névtelen';
    const p = chat.projects.find(
      (x) => x.cwd.toLowerCase() === chat.cwd.trim().toLowerCase(),
    );
    return p?.name ?? projectNameOf(chat.cwd.trim());
  })();

  const onProjectSelect = async (value: string): Promise<void> => {
    if (value === '__add__') {
      await chat.addProject();
      return;
    }
    chat.setCwd(value);
  };

  const composerBox = (
    <div className={`composer${showHome ? ' big' : ''}`}>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={
          running
            ? 'Üzenet a futó agentnek… (Enter = sorba áll)'
            : showHome
              ? 'Írd le a feladatot…'
              : 'Feladat leírása…'
        }
        rows={showHome ? 3 : 2}
        autoFocus
      />
      <div className="composer-row">
        <Segmented
          options={[
            { value: 'agent', label: 'Agent', hint: 'egy agent végzi a munkát — automatikusan folytatja, míg kész' },
            { value: 'experts', label: 'Experts', hint: 'több szakértői al-agent dolgozik párhuzamosan' },
          ]}
          value={chat.uiMode}
          onChange={(v) => chat.setUiMode(v as typeof chat.uiMode)}
          accent="uimode"
        />
        <Segmented
          options={MODES.map((m) => ({ value: m.value, label: m.label, hint: m.hint }))}
          value={chat.mode}
          onChange={(v) => chat.setMode(v as typeof chat.mode)}
          accent="mode"
        />
        <div className="effort-wrap" title="Thinking effort">
          <span className="effort-label">thinking</span>
          <Segmented
            options={EFFORTS.map((e) => ({ value: e.value, label: e.label, hint: e.label }))}
            value={chat.effort}
            onChange={(v) => chat.setEffort(v as typeof chat.effort)}
            accent="effort"
          />
        </div>

        <div className="spacer" />

        <ContextRing
          used={chat.tokensUsed}
          max={chat.contextWindow}
          model={chat.model || chat.selectedProvider?.defaultModel || ''}
          onClick={() => chat.openUsageTab()}
        />

        {running && (
          <button className="send stop" onClick={() => void chat.stop()} title="Leállítás">
            Stop
          </button>
        )}
        <button
          className="send"
          onClick={submit}
          disabled={!draft.trim()}
          title={running ? 'Sorba állítás (Enter)' : 'Küldés (Enter)'}
        >
          ↑
        </button>
      </div>
    </div>
  );

  return (
    <div className="shell">
      <Sidebar
        sessions={chat.sessions}
        projects={chat.projects}
        activeSessionId={chat.activeSessionId}
        onOpen={(id) => void chat.openSession(id)}
        onDelete={(id) => void chat.removeSession(id)}
        onNewChat={chat.newChat}
        onAddProject={() => void chat.addProject()}
        onNewChatInProject={(cwd) => {
          chat.newChat();
          chat.setCwd(cwd);
        }}
        theme={theme}
        onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        settingsOpen={showSettings}
        onToggleSettings={() => setShowSettings((v) => !v)}
        onCloseSettings={() => {
          setShowSettings(false);
          void chat.reloadProviders();
        }}
        avatar={avatarCfg}
        onOpenAccount={() => setShowProfile(true)}
      />

      <div className="main">
        <header className="bar">
          <div className="brand">
            <span className="brand-name">Qodea</span>
          </div>

          <div className="bar-right">
            <input
              className="ghost-input cwd"
              placeholder="project folder…"
              value={chat.cwd}
              onChange={(e) => chat.setCwd(e.target.value)}
              spellCheck={false}
            />
            <select
              className="ghost-select"
              value={chat.providerId}
              onChange={(e) => {
                chat.setProviderId(e.target.value);
                const p = chat.providers.find((x) => x.id === e.target.value);
                chat.setModel(p?.defaultModel ?? '');
              }}
            >
              {chat.providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <button
              className={`ghost-btn${chat.panelOpen ? ' on' : ''}`}
              title="Agent panel"
              onClick={() => chat.setPanelOpen(!chat.panelOpen)}
            >
              Agentek
              {runningAgents > 0 && <span className="run-badge">{runningAgents}</span>}
            </button>
          </div>
        </header>

        {chat.errorBanner && <div className="banner">{chat.errorBanner}</div>}

        {showHome ? (
          <div className="home">
            <QodeaBot mood={heroMood} color="cream" size={86} />
            <h1>Több mint chat. Megcsinálja.</h1>
            <p className="sub">Mondd meg, mi kell — a Qodea megtervezi, megírja és lefuttatja.</p>

            {composerBox}

            <label className="folder-line" title="Melyik projektben dolgozzon?">
              Projekt:{' '}
              <select
                className="folder-select"
                value={
                  chat.projects.some((p) => p.cwd === chat.cwd.trim()) || !chat.cwd.trim()
                    ? chat.cwd.trim()
                    : '__custom__'
                }
                onChange={(e) => void onProjectSelect(e.target.value)}
              >
                <option value="">Névtelen</option>
                {chat.projects.map((p) => (
                  <option key={p.id} value={p.cwd}>
                    {p.name}
                  </option>
                ))}
                {!chat.cwd.trim() ||
                chat.projects.some((p) => p.cwd === chat.cwd.trim()) ? null : (
                  <option value="__custom__">{projectLabel}</option>
                )}
                <option value="__add__">Új projekt mappa…</option>
              </select>
            </label>
          </div>
        ) : (
          <>
            {/* stream */}
            <div ref={streamRef} className="stream">
              <div className="col">
                {chat.items.map((item) => (
                  <Row
                    key={item.id}
                    item={item}
                    onRespond={(id, ok) => void chat.respond(id, ok)}
                    onOpenFile={(title, content) => chat.openFileTab(title, content)}
                  />
                ))}
              </div>
            </div>

            {/* dock */}
            <footer className="dock">{composerBox}</footer>
          </>
        )}
      </div>

      {(chat.panelOpen ||
        chat.deployedAgents.length > 0 ||
        chat.extraTabs.length > 0) && (
        <AgentPanel
          deployed={chat.deployedAgents}
          streams={chat.agentStreams}
          openTabs={chat.openAgentTabs}
          activeTab={chat.activeAgentTab}
          onActivate={chat.setActiveAgentTab}
          onCloseTab={chat.closePanelTab}
          extraTabs={chat.extraTabs}
          lifetime={lifetime}
          usage={{
            calls: chat.usageCalls,
            tokensUsed: chat.tokensUsed,
            contextWindow: chat.contextWindow,
            model: chat.model || chat.selectedProvider?.defaultModel || '',
            messagesCount: chat.messagesCount,
          }}
        />
      )}

      {showSettings && (
        <div
          className="modal-back"
          onClick={() => {
            setShowSettings(false);
            void chat.reloadProviders();
          }}
        >
          <div className="profile-modal" onClick={(e) => e.stopPropagation()}>
            <Settings
              onClose={() => {
                setShowSettings(false);
                void chat.reloadProviders();
              }}
            />
          </div>
        </div>
      )}

      {showProfile && (
        <div className="modal-back" onClick={() => setShowProfile(false)}>
          <div className="profile-modal" onClick={(e) => e.stopPropagation()}>
            <header className="set-head">
              <h2>Profil és avatar</h2>
              <button className="icon-btn" onClick={() => setShowProfile(false)} title="Bezárás">
                ×
              </button>
            </header>
            <ProfileStats lifetime={lifetime} projects={projectCount} />
            <AvatarEditor
              initial={avatarCfg}
              onSave={(cfg) => {
                setAvatarCfg(cfg);
                saveAvatar(cfg);
                setShowProfile(false);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* ── profile lifetime stats ─────────────────────────────────────────────── */

function ProfileStats({
  lifetime,
  projects,
}: {
  lifetime: LifetimeStats | null;
  projects: number;
}) {
  if (!lifetime || Object.keys(lifetime.models).length === 0) return null;

  let inTok = 0, outTok = 0, cached = 0, calls = 0, cost = 0, costKnown = true;
  for (const [model, m] of Object.entries(lifetime.models)) {
    inTok += m.inTok;
    outTok += m.outTok;
    cached += m.cachedTok;
    calls += m.calls;
    const c = estimateCost(model, m.inTok, m.outTok);
    if (c === null) costKnown = false;
    else cost += c;
  }
  const hitRate = inTok > 0 ? Math.round((cached / inTok) * 100) : 0;

  return (
    <div className="prof-stats">
      <SectionTitleMini>Összes használat</SectionTitleMini>
      <div className="ps-grid">
        <PsCard label="Token be" value={inTok.toLocaleString('hu-HU')} />
        <PsCard label="Token ki" value={outTok.toLocaleString('hu-HU')} />
        <PsCard label="Cache" value={`${cached.toLocaleString('hu-HU')} (${hitRate}%)`} />
        <PsCard
          label="Becsült költség"
          value={costKnown ? `$${cost.toFixed(2)}` : '$? (ismeretlen modell)'}
        />
        <PsCard label="Hívások" value={String(calls)} />
        <PsCard label="Projektek" value={String(projects)} />
      </div>
    </div>
  );
}

function SectionTitleMini({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--faint)', margin: '4px 0 8px' }}>
      {children}
    </div>
  );
}

function PsCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="ps-card">
      <span className="ps-label">{label}</span>
      <span className="ps-value">{value}</span>
    </div>
  );
}

/* ── segmented control ─────────────────────────────────────────────────── */

function Segmented({
  options,
  value,
  onChange,
  accent,
}: {
  options: Array<{ value: string; label: string; hint?: string }>;
  value: string;
  onChange: (v: string) => void;
  accent: 'mode' | 'effort' | 'uimode';
}) {
  return (
    <div className={`seg ${accent}`} role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          title={o.hint}
          className={`${value === o.value ? 'on' : ''}${o.value === 'yolo' ? ' yolo' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ── context usage ring ────────────────────────────────────────────────── */

function ContextRing({
  used,
  max,
  model,
  onClick,
}: {
  used: number;
  max: number;
  model: string;
  onClick?: () => void;
}) {
  const pct = Math.min(1, max > 0 ? used / max : 0);
  const R = 10;
  const C = 2 * Math.PI * R;
  const col = pct < 0.55 ? '#6fbf8f' : pct < 0.8 ? '#d78f3f' : '#e25b43';

  return (
    <div
      className="ctx"
      tabIndex={0}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      style={onClick ? { cursor: 'pointer' } : undefined}
    >
      <svg viewBox="0 0 26 26" width="24" height="24">
        <circle cx="13" cy="13" r={R} fill="none" stroke="#232329" strokeWidth="3.5" />
        <circle
          cx="13"
          cy="13"
          r={R}
          fill="none"
          stroke={col}
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray={`${(C * pct).toFixed(1)} ${C.toFixed(1)}`}
          transform="rotate(-90 13 13)"
        />
      </svg>
      <div className="tip" role="tooltip">
        <div className="t-title">Context</div>
        <div className="t-big">{Math.round(pct * 100)}%</div>
        <div className="t-row">
          {used.toLocaleString('hu-HU')} / {max.toLocaleString('hu-HU')} token
        </div>
        {model && <div className="t-dim">{model}</div>}
        <div className="t-dim">a teljes beszélgetés + tool eredmények beleszámítanak</div>
      </div>
    </div>
  );
}
