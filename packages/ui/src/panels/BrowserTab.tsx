import { useCallback, useEffect, useRef, useState } from 'react';

/** Live browser viewer: screencast frames + click/type passthrough. */
export function BrowserTab() {
  const [frame, setFrame] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = () => {
      void window.qodea
        .browserFrame()
        .then((f: string | null) => {
          if (alive && f) setFrame(f);
        })
        .catch(() => {});
      timer.current = setTimeout(poll, 450);
    };
    poll();
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const navigate = useCallback(() => {
    const u = url.trim();
    if (!u) return;
    const full = /^https?:\/\//i.test(u) ? u : `https://${u}`;
    setUrl('');
    void window.qodea.browserNavigate(full);
  }, [url]);

  const clickOn = (e: React.MouseEvent<HTMLImageElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const yPct = ((e.clientY - rect.top) / rect.height) * 100;
    void window.qodea.browserClick(xPct, yPct);
  };

  return (
    <div className="browser-tab">
      <div className="bt-urlbar">
        <input
          value={url}
          placeholder="URL…"
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && navigate()}
          spellCheck={false}
        />
        <button onClick={navigate}>Go</button>
      </div>
      {frame ? (
        <img className="bt-frame" src={`data:image/jpeg;base64,${frame}`} alt="browser" onClick={clickOn} />
      ) : (
        <div className="rp-empty bt-wait">
          Nincs élő böngésző.<br />Az agent browser_navigate-e után itt jelenik meg a stream.
        </div>
      )}
    </div>
  );
}
