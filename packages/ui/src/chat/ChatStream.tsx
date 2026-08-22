import { useEffect, useRef } from 'react';
import type { ChatItem } from './useChatSession';

interface Props {
  items: ChatItem[];
  onRespond?: (requestId: string, approved: boolean) => void;
}

export function ChatStream({ items, onRespond }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [items]);

  return (
    <div className="stream" aria-live="polite">
      {items.length === 0 && (
        <div className="stream-empty">
          <p>Írd be a feladatot — Qodea olvas, ír, futtat, amíg kész nem lesz.</p>
          <p className="dim">pl. „Nézd meg a repót és írd meg a README-t” vagy „javítsd ki a failing teszteket”</p>
        </div>
      )}

      {items.map((item) => (
        <Item key={item.id} item={item} onRespond={onRespond} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

function Item({
  item,
  onRespond,
}: {
  item: ChatItem;
  onRespond?: (requestId: string, approved: boolean) => void;
}) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="msg msg-user">
          <div className="bubble">{item.text}</div>
        </div>
      );

    case 'assistant':
      return (
        <div className="msg msg-assistant">
          <div className="bubble">{item.text}</div>
        </div>
      );

    case 'tool': {
      const stateClass = item.running ? ' tool-running' : item.isError ? ' tool-error' : '';
      return (
        <details className={`tool-card${stateClass}`}>
          <summary>
            <span className="tool-icon">{item.running ? '⚙' : item.isError ? '✖' : '✔'}</span>
            <span className="tool-name">{item.name}</span>
            {item.summary && <span className="tool-summary">{item.summary}</span>}
            {item.running && <span className="spinner" aria-label="fut" />}
          </summary>
          {item.content !== undefined && <pre className="tool-output">{item.content}</pre>}
        </details>
      );
    }

    case 'permission': {
      if (item.resolved) {
        return (
          <div className={`perm-card resolved${item.isError ? ' denied' : ''}`}>
            {item.isError ? '⛔ elutasítva' : '✅ engedélyezve'} · {item.name}: {item.summary}
          </div>
        );
      }
      return (
        <div className="perm-card">
          <div className="perm-head">
            <strong>{item.name}</strong> kér engedélyt
          </div>
          <code className="perm-summary">{item.summary}</code>
          <div className="perm-actions">
            <button
              className="btn btn-allow"
              onClick={() => item.requestId && onRespond?.(item.requestId, true)}
            >
              Engedélyezem
            </button>
            <button
              className="btn btn-deny"
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
