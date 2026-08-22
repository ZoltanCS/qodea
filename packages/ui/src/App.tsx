import { useCallback, useEffect, useState } from 'react';
import { QodeaBot } from './mascot/QodeaBot';
import { ChatStream } from './chat/ChatStream';
import { useChatSession } from './chat/useChatSession';

export function App() {
  const chat = useChatSession();
  const [draft, setDraft] = useState('');

  const submit = useCallback(() => {
    const task = draft;
    if (!task.trim() || chat.status === 'running') return;
    setDraft('');
    void chat.send(task);
  }, [draft, chat]);

  // Enter sends, Shift+Enter makes a newline
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const noProviders = chat.providers.length === 0;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <QodeaBot mood={chat.mood} color={chat.color} size={44} />
          <span className="wordmark-sm">Qodea</span>
          {chat.status === 'running' && <span className="status-pill">dolgozik…</span>}
        </div>

        {!noProviders && (
          <div className="controls">
            <select
              aria-label="Provider"
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

            <input
              className="model-input"
              aria-label="Modell"
              placeholder={chat.selectedProvider?.defaultModel ?? 'model'}
              value={chat.model}
              onChange={(e) => chat.setModel(e.target.value)}
            />

            <div className="mode-switch" role="radiogroup" aria-label="Mód">
              {chat.DEFAULT_MODES.map((m) => (
                <button
                  key={m.value}
                  title={m.hint}
                  role="radio"
                  aria-checked={chat.mode === m.value}
                  className={`mode-btn${m.value === 'yolo' ? ' mode-yolo' : ''}${
                    chat.mode === m.value ? ' active' : ''
                  }`}
                  onClick={() => chat.setMode(m.value)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </header>

      {noProviders ? (
        <SetupScreen />
      ) : (
        <>
          <main className="stream-wrap">
            {chat.errorBanner && <div className="error-banner">{chat.errorBanner}</div>}
            <ChatStream items={chat.items} onRespond={(id, ok) => void chat.respond(id, ok)} />
          </main>

          <footer className="composer">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={
                chat.status === 'running'
                  ? 'Qodea dolgozik…'
                  : 'Mi legyen a feladat?  (Enter = küldés, Shift+Enter = új sor)'
              }
              disabled={chat.status === 'running'}
              rows={2}
            />
            {chat.status === 'running' ? (
              <button className="btn btn-stop" onClick={() => void chat.stop()}>
                ■ Stop
              </button>
            ) : (
              <button
                className="btn btn-send"
                onClick={submit}
                disabled={!draft.trim()}
                title={chat.cwd.trim() ? `cwd: ${chat.cwd.trim()}` : 'cwd: nincs beállítva'}
              >
                ➤ Küldés
              </button>
            )}
          </footer>
        </>
      )}
    </div>
  );
}

function SetupScreen() {
  return (
    <div className="setup">
      <h2>Először egy provider kell</h2>
      <p>
        Állíts be egy kulcsot környezeti változóként, vagy hozz létre{' '}
        <code>~/.qodea/config.json</code> fájlt, majd indítsd újra az appot.
      </p>
      <pre>{`# példa — Azure OpenAI
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_ENDPOINT=https://TE-RESOURCE.openai.azure.com

# vagy OpenAI / Anthropic / Cerebras / Zen
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
CEREBRAS_API_KEY=...
OPENCODE_API_KEY=...`}</pre>
      <p className="dim">
        Részletek: README.md → Configuration. A config fájlban egyéni base_url-lel bármi
        OpenAI-kompatibilis végpont működik.
      </p>
    </div>
  );
}
