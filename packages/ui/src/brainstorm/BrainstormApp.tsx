import { useCallback, useEffect, useRef, useState } from 'react';

let idc = 0;
const nid = () => `b${++idc}`;

interface BItem {
  id: string;
  kind: 'user' | 'assistant' | 'image';
  text?: string;
}

interface Attachment {
  name: string;
  kind: 'image' | 'text';
  dataUri?: string;
  text?: string;
}

/** Minimal brainstorm window: chat + live previews + attach. */
export function BrainstormApp() {
  const [items, setItems] = useState<BItem[]>([]);
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [running, setRunning] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [handed, setHanded] = useState(false);
  const streamRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = streamRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items]);

  // listen for events (this window's session)
  useEffect(() => {
    const unsub = window.qodea.onEvent((_sid, ev) => {
      switch (ev.type) {
        case 'text-delta': {
          setItems((prev) => {
            const last = prev[prev.length - 1];
            if (last?.kind === 'assistant') {
              const copy = [...prev.slice(0, -1)];
              copy.push({ ...last, text: (last.text ?? '') + ev.text });
              return copy;
            }
            return [...prev, { kind: 'assistant', id: nid(), text: ev.text }];
          });
          break;
        }
        case 'reasoning-delta':
          break;
        case 'tool-start':
          if (ev.name === 'generate_image') {
            setItems((prev) => [
              ...prev,
              { kind: 'assistant', id: nid(), text: 'képet generál…' },
            ]);
          }
          break;
        case 'tool-result': {
          if (ev.name === 'generate_image' && ev.content.startsWith('data:')) {
            setItems((prev) => [...prev, { kind: 'image', id: nid(), text: ev.content }]);
          }
          break;
        }
        case 'session-done': {
          setRunning(false);
          // [READY] marker → show the bring-to-life button
          const last = prev_hasReady(itemsRef.current);
          setReady(last);
          break;
        }
        default:
          break;
      }
    });
    return unsub;
  }, []);

  const itemsRef = useRef<BItem[]>([]);
  itemsRef.current = items;

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed && attachments.length === 0) return;
      if (running) return;

      setItems((prev) => [...prev, { kind: 'user', id: nid(), text: trimmed }]);
      setRunning(true);

      const images = attachments.filter((a) => a.kind === 'image').map((a) => a.dataUri!);
      const fileTexts = attachments
        .filter((a) => a.kind === 'text')
        .map((a) => `\n\n[Attached file: ${a.name}]\n${a.text}`)
        .join('');

      try {
        const res = await window.qodea.startSession({
          ...(sessionId ? { sessionId } : {}),
          task: (trimmed || 'Folytasd') + fileTexts,
          mode: 'yolo',
          cwd: '',
          brainstorm: true,
          ...(images.length > 0 ? { images } : {}),
          ...(sessionId && itemsRef.current.length > 2
            ? {}
            : {}),
        } as Parameters<typeof window.qodea.startSession>[0]);
        setSessionId(res.sessionId);
        setAttachments([]);
      } catch (err) {
        setItems((prev) => [
          ...prev,
          { kind: 'assistant', id: nid(), text: `Hiba: ${err instanceof Error ? err.message : String(err)}` },
        ]);
        setRunning(false);
      }
    },
    [running, sessionId, attachments],
  );

  const bringToLife = useCallback(async () => {
    if (!sessionId) return;
    try {
      await window.qodea.brainstormMaterialize(sessionId);
      setHanded(true);
      setTimeout(() => void window.qodea.closeBrainstormWindow(), 1400);
    } catch (err) {
      setItems((prev) => [
        ...prev,
        { kind: 'assistant', id: nid(), text: `Hiba: ${err instanceof Error ? err.message : String(err)}` },
      ]);
    }
  }, [sessionId]);

  const onFiles = useCallback(async (files: FileList | null) => {
    if (!files) return;
    const next: Attachment[] = [];
    for (const file of Array.from(files)) {
      if (/^image\//i.test(file.type)) {
        const dataUri = await readAsDataUri(file);
        next.push({ name: file.name, kind: 'image', dataUri });
      } else {
        const text = await file.text();
        next.push({ name: file.name, kind: 'text', text: text.slice(0, 20_000) });
      }
    }
    setAttachments((prev) => [...prev, ...next]);
  }, []);

  if (handed) {
    return (
      <div className="bs handed">
        <div className="bs-done">Átadva a fő agentnek.</div>
        <div className="dim">Ez az ablak bezárul…</div>
      </div>
    );
  }

  return (
    <div className="bs">
      <div ref={streamRef} className="bs-stream">
        {items.length === 0 && (
          <div className="bs-empty">
            <p>Brainstorm</p>
            <p className="dim">Beszélgess a projektről — ötletek, design, terv.<br/>Amikor kész, átadjuk az agentnek.</p>
          </div>
        )}
        {items.map((it) => (
          <BrainstormRow key={it.id} item={it} />
        ))}
      </div>

      {ready && !handed && (
        <button className="bs-bring" onClick={() => void bringToLife()}>
          Bring it to life
        </button>
      )}

      <div className="bs-composer">
        <label className="bs-plus" title="Fájl csatolása">
          +
          <input
            type="file"
            multiple
            accept="image/*,.txt,.md,.js,.ts,.jsx,.tsx,.html,.css,.json,.py"
            style={{ display: 'none' }}
            onChange={(e) => void onFiles(e.target.files)}
          />
        </label>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              const t = draft;
              if (!t.trim()) return;
              setDraft('');
              void send(t);
            }
          }}
          placeholder={running ? 'gondolkodik…' : 'Írd le az ötletet…'}
          rows={1}
        />
        <button
          className={`bs-send${draft.trim() ? ' ready' : ''}`}
          disabled={running || !draft.trim()}
          onClick={() => {
            const t = draft;
            if (!t.trim()) return;
            setDraft('');
            void send(t);
          }}
        >
          ➤
        </button>
      </div>

      {attachments.length > 0 && (
        <div className="bs-attachments">
          {attachments.map((a, i) => (
            <span key={i} className="bs-att">
              {a.kind === 'image' ? '[img] ' : '[file] '}
              {a.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function BrainstormRow({ item }: { item: BItem }) {
  if (item.kind === 'user') {
    return (
      <div className="bs-row user">
        <div className="bs-bubble">{item.text}</div>
      </div>
    );
  }
  if (item.kind === 'image') {
    return (
      <div className="bs-row">
        <img className="bs-img" src={item.text} alt="generated" />
      </div>
    );
  }
  // assistant: split preview blocks out of the text
  const parts = splitPreviews(item.text ?? '');
  return (
    <div className="bs-row ai">
      {parts.map((p, i) =>
        p.type === 'preview' ? (
          <iframe
            key={i}
            className="bs-preview"
            srcDoc={p.content}
            sandbox="allow-scripts"
            title="preview"
          />
        ) : (
          <div key={i} className="bs-text md">
            {p.content}
          </div>
        ),
      )}
    </div>
  );
}

function splitPreviews(text: string): Array<{ type: 'text' | 'preview'; content: string }> {
  const out: Array<{ type: 'text' | 'preview'; content: string }> = [];
  const re = /```preview\n([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ type: 'text', content: text.slice(last, m.index) });
    out.push({ type: 'preview', content: m[1] ?? '' });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: 'text', content: text.slice(last) });
  return out;
}

function readAsDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function prev_hasReady(items: BItem[]): boolean {
  const last = items[items.length - 1];
  return last?.kind === 'assistant' && /\[READY\]/.test(last.text ?? '');
}
