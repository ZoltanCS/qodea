export function App() {
  return (
    <main className="boot">
      <MascotIdle />
      <h1 className="wordmark">Qodea</h1>
      <p className="status">M0 · scaffold online — agent core coming in M1</p>
    </main>
  );
}

/** Placeholder for the real mascot system (M2): idle white form, gently breathing. */
function MascotIdle() {
  return (
    <svg className="mascot-idle" viewBox="0 0 200 200" width="140" height="140" aria-hidden>
      <defs>
        <radialGradient id="ballGrad" cx="35%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#d8d6cf" />
        </radialGradient>
      </defs>
      <g className="breathe">
        <circle cx="100" cy="104" r="78" fill="#050505" opacity="0.55" />
        <circle cx="100" cy="98" r="78" fill="url(#ballGrad)" />
        <ellipse cx="82" cy="96" rx="9" ry="16" fill="#17171a" />
        <ellipse cx="122" cy="96" rx="9" ry="16" fill="#17171a" />
      </g>
    </svg>
  );
}
