import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { QodeaBot } from './mascot/QodeaBot';
import { useChatSession, MODES, EFFORTS, type ChatItem } from './chat/useChatSession';
import { Sidebar } from './sidebar/Sidebar';

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
  const streamRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
    localStorage.setItem('qodea-theme', theme);
  }, [theme]);

  const submit = useCallback(() => {
    if (!draft.trim() || chat.status === 'running') return;
    const task = draft;
    setDraft('');
    void chat.send(task);
  }, [draft, chat]);

  useEffect(() => {
    const el = streamRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.items]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const running = chat.status === 'running';
  const showHome = !running && chat.items.length === 0 && !chat.activeSessionId;

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
            ? 'Qodea dolgozik…'
            : showHome
              ? 'Írd le a feladatot…'
              : 'Feladat leírása…'
        }
        disabled={running}
        rows={showHome ? 3 : 2}
        autoFocus
      />
      <div className="composer-row">
        <Segmented
          options={[
            { value: 'agent', label: 'Agent', hint: 'egy agent végzi a munkát' },
            { value: 'experts', label: 'Experts', hint: 'több szakértői nézőpont' },
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
        />

        {running ? (
          <button className="send stop" onClick={() => void chat.stop()} title="Leállítás">
            ■
          </button>
        ) : (
          <button className="send" onClick={submit} disabled={!draft.trim()} title="Küldés (Enter)">
            ↑
          </button>
        )}
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
      />

      <div className="main">
        <header className="bar">
          <div className="brand">
            <QodeaBot mood={chat.mood} color={chat.color} size={26} />
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
          </div>
        </header>

        {chat.errorBanner && <div className="banner">{chat.errorBanner}</div>}

        {showHome ? (
          <div className="home">
            <QodeaBot mood="idle" color="cream" size={86} />
            <h1>Több mint chat. Megcsinálja.</h1>
            <p className="sub">
              Mondd meg, mi kell — a Qodea megtervezi, megírja és lefuttatja.
            </p>

            {composerBox}

            <label className="folder-line" title="Melyik projektben dolgozzon?">
              ▤ Projekt:{' '}
              <select
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
                {!chat.cwd.trim() || chat.projects.some((p) => p.cwd === chat.cwd.trim()) ? null : (
                  <option value="__custom__">{projectLabel}</option>
                )}
                <option value="__add__">＋ Új projekt mappa…</option>
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
                  />
                ))}
              </div>
            </div>

            {/* dock */}
            <footer className="dock">{composerBox}</footer>
          </>
        )}
      </div>
    </div>
  );
}

/* ── message rows ─────────────────────────────────────────────────────────── */

function Row({
  item,
  onRespond,
}: {
  item: ChatItem;
  onRespond: (requestId: string, approved: boolean) => void;
}) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="row user">
          <div className="u-bubble">{item.text}</div>
        </div>
      );

    case 'assistant':
      return (
        <div className="row assistant">
          {item.reasoning && <Thinking text={item.reasoning} live={!item.text} />}
          {item.text && (
            <div className="md" onClick={blockLinks}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.text}</ReactMarkdown>
            </div>
          )}
        </div>
      );

    case 'tool': {
      const cls = item.running ? ' run' : item.isError ? ' err' : '';
      return (
        <details className={`chip${cls}`}>
          <summary>
            <span className="dot">{item.running ? '●' : item.isError ? '✕' : '✓'}</span>
            <code>{item.name}</code>
            {item.summary && <span className="s">{item.summary}</span>}
          </summary>
          {item.content !== undefined && <pre>{item.content}</pre>}
        </details>
      );
    }

    case 'permission': {
      if (item.resolved) {
        return (
          <div className={`perm done${item.isError ? ' no' : ''}`}>
            {item.isError ? 'elutasítva' : 'engedélyezve'} · <code>{item.name}</code>
          </div>
        );
      }
      return (
        <div className="perm">
          <div className="q">
            <strong>{item.name}</strong> — engedély kell
          </div>
          <code className="what">{item.summary}</code>
          <div className="acts">
            <button className="ok" onClick={() => item.requestId && onRespond(item.requestId, true)}>
              Engedélyezem
            </button>
            <button className="nope" onClick={() => item.requestId && onRespond(item.requestId, false)}>
              Nem
            </button>
          </div>
        </div>
      );
    }
  }
}

/* ── thinking block ───────────────────────────────────────────────────────── */

function Thinking({ text, live }: { text: string; live: boolean }) {
  if (live) {
    return (
      <div className="think live">
        <span className="lbl">gondolkodik</span>
        <div className="t-body">{text}</div>
      </div>
    );
  }
  return (
    <details className="think">
      <summary>gondolatmenet</summary>
      <div className="t-body">{text}</div>
    </details>
  );
}

/** Keep in-app markdown links from navigating the Electron window away. */
function blockLinks(e: React.MouseEvent<HTMLDivElement>): void {
  const target = e.target as HTMLElement;
  if (target.tagName === 'A') e.preventDefault();
}

/* ── segmented control ────────────────────────────────────────────────────── */

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

/* ── context usage ring ───────────────────────────────────────────────────── */

function ContextRing({ used, max, model }: { used: number; max: number; model: string }) {
  const pct = Math.min(1, max > 0 ? used / max : 0);
  const R = 10;
  const C = 2 * Math.PI * R;
  const col = pct < 0.55 ? '#6fbf8f' : pct < 0.8 ? '#d78f3f' : '#e25b43';

  return (
    <div className="ctx" tabIndex={0}>
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
