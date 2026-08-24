import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Icon } from '../ui/Icon';

export interface ChatItem {
  id: string;
  kind: 'user' | 'assistant' | 'tool' | 'permission';
  text?: string;
  /** live reasoning ("thinking") stream */
  reasoning?: string;
  /** tool result output */
  content?: string;
  name?: string;
  summary?: string;
  isError?: boolean;
  running?: boolean;
  queued?: boolean;
  startedAt?: number;
  durationMs?: number;
  requestId?: string;
  resolved?: boolean;
}

/** Message row renderer shared by the main chat and agent panels. */
export function Row({
  item,
  onRespond,
  onOpenFile,
}: {
  item: ChatItem;
  onRespond?: (requestId: string, approved: boolean) => void;
  onOpenFile?: (title: string, content: string) => void;
}) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="row user">
          <div className={`u-bubble${item.queued ? ' q' : ''}`}>
            {item.text}
            {item.queued && <span className="q-tag">· sorban</span>}
          </div>
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

    case 'tool':
      return <ToolCard item={item} onOpenFile={onOpenFile} />;

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
            <button
              className="ok"
              onClick={() => item.requestId && onRespond?.(item.requestId, true)}
            >
              Engedélyezem
            </button>
            <button
              className="nope"
              onClick={() => item.requestId && onRespond?.(item.requestId, false)}
            >
              Nem
            </button>
          </div>
        </div>
      );
    }
  }
}

/* ── thinking block ── */

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

function blockLinks(e: React.MouseEvent<HTMLDivElement>): void {
  const target = e.target as HTMLElement;
  if (target.tagName === 'A') e.preventDefault();
}

/* ── tool call card ── */

const TOOL_META: Record<string, { verb: string; icon: Parameters<typeof Icon>[0]['name'] }> = {
  read_file: { verb: 'Olvasás', icon: 'file' },
  write_file: { verb: 'Írás', icon: 'filePlus' },
  edit_file: { verb: 'Szerkesztés', icon: 'pen' },
  glob_files: { verb: 'Fájlkeresés', icon: 'search' },
  grep_files: { verb: 'Keresés', icon: 'search' },
  bash: { verb: 'Parancs', icon: 'terminal' },
  todo_write: { verb: 'Teendők', icon: 'list' },
  spawn_agent: { verb: 'Al-agent indítása', icon: 'agents' },
  web_search: { verb: 'Webkeresés', icon: 'search' },
  web_fetch: { verb: 'Oldal olvasása', icon: 'file' },
  browser_navigate: { verb: 'Böngésző: megnyitás', icon: 'globe' },
  browser_snapshot: { verb: 'Böngésző: elemzés', icon: 'search' },
  browser_click: { verb: 'Böngésző: kattintás', icon: 'pen' },
  browser_type: { verb: 'Böngésző: beírás', icon: 'file' },
  browser_scroll: { verb: 'Böngésző: görgetés', icon: 'list' },
  browser_screenshot: { verb: 'Képernyőkép', icon: 'camera' },
  browser_close: { verb: 'Böngésző: bezárás', icon: 'gear' },
};

function toolArgs(name: string, summary?: string): string {
  if (!summary) return '';
  if (name === 'bash') {
    const stripped = summary.replace(/^run\s+`?/, '').replace(/`$/, '');
    return stripped.length > 80 ? `${stripped.slice(0, 80)}…` : stripped;
  }
  const sp = summary.indexOf(' ');
  const rest = sp > -1 ? summary.slice(sp + 1) : '';
  return rest.length > 70 ? `${rest.slice(0, 70)}…` : rest;
}

export function ToolCard({
  item,
  onOpenFile,
}: {
  item: ChatItem;
  onOpenFile?: (title: string, content: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [, tick] = useState(0);
  const meta =
    TOOL_META[item.name ?? ''] ?? { verb: 'Eszköz', icon: 'terminal' as const };
  const argText = toolArgs(item.name ?? '', item.summary);

  useEffect(() => {
    if (!item.running) return;
    const id = setInterval(() => tick((t) => t + 1), 500);
    return () => clearInterval(id);
  }, [item.running]);

  if (item.running) {
    const elapsed = item.startedAt ? Math.max(0, (Date.now() - item.startedAt) / 1000) : 0;
    return (
      <div className="tool-card run open">
        <div className="tc-head">
          <span className="tc-icon run">
            <Icon name={meta.icon} size={14} />
          </span>
          <span className="tc-verb">{meta.verb}</span>
          {argText && <code className="tc-arg">{argText}</code>}
          <span className="tc-right">
            <span className="tc-dur">{elapsed.toFixed(0)} s</span>
            <span className="spin" aria-label="fut" />
            <span className="tc-runlabel">fut…</span>
          </span>
        </div>
        <div className="tc-live">
          <div className="shimmer" />
        </div>
      </div>
    );
  }

  const copy = async () => {
    if (!item.content) return;
    try {
      await navigator.clipboard.writeText(item.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <details className={`tool-card ${item.isError ? 'err' : 'ok'}`}>
      <summary>
        <span className={`tc-icon ${item.isError ? 'e' : 'ok'}`}>
          <Icon name={meta.icon} size={14} />
        </span>
        <span className="tc-verb">{meta.verb}</span>
        {argText && <code className="tc-arg">{argText}</code>}
        <span className="tc-right">
          {typeof item.durationMs === 'number' && (
            <span className="tc-dur">{(item.durationMs / 1000).toFixed(1)} s</span>
          )}
          <span className={`tc-dot ${item.isError ? 'e' : 'ok'}`} />
        </span>
        <svg
          className="chev"
          viewBox="0 0 24 24"
          width="12"
          height="12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        >
          <path d="M8 10 L16 10 L12 15 Z" strokeLinejoin="round" />
        </svg>
      </summary>
      {item.content !== undefined && item.content.length > 0 && (
        <div className="tc-body">
          {onOpenFile && (
            <button
              className="tc-copy"
              style={{ right: 84 }}
              onClick={() =>
                onOpenFile(item.summary ?? item.name ?? 'fájl', item.content ?? '')
              }
            >
              Panel
            </button>
          )}
          <button className="tc-copy" onClick={() => void copy()}>
            {copied ? 'Kimásolva' : 'Másolás'}
          </button>
          <pre>{item.content}</pre>
        </div>
      )}
    </details>
  );
}
