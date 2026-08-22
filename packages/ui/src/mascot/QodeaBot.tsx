import { useEffect, useId, useRef } from 'react';

export type BotMood =
  | 'idle'
  | 'thinking'
  | 'working'
  | 'waiting'
  | 'error'
  | 'success';

export type BotColor = 'cream' | 'red' | 'blue';

export interface QodeaBotProps {
  mood?: BotMood;
  color?: BotColor;
  size?: number;
}

const PALETTES: Record<BotColor, { hi: string; mid: string; lo: string }> = {
  cream: { hi: '#ffffff', mid: '#eae6da', lo: '#c9c3b1' },
  red: { hi: '#ff9d8f', mid: '#ee4634', lo: '#a92718' },
  blue: { hi: '#bfe0ff', mid: '#57a5ef', lo: '#2c6cae' },
};

const MAX_EYE_OFFSET = 6;
const MAX_BODY_TILT = 2.4;

/**
 * The Qodea agent avatar. Mood will be derived from the core event stream (M2);
 * today it is a plain prop. The eyes (and the body, subtly) follow the cursor,
 * so the bot always feels alive.
 *
 * Original artwork — simple geometry, no third-party assets.
 */
export function QodeaBot({ mood = 'idle', color = 'cream', size = 140 }: QodeaBotProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const gradId = `qb-grad-${uid}`;
  const shadowId = `qb-shadow-${uid}`;
  const pal = PALETTES[color];

  const rootRef = useRef<SVGSVGElement>(null);
  const tiltRef = useRef<SVGGElement>(null);
  const trackRef = useRef<SVGGElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const tilt = tiltRef.current;
    const track = trackRef.current;
    if (!root || !tilt || !track) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const mouse = { x: 0, y: 0 };
    const cur = { ex: 0, ey: 0, rot: 0 };

    const onMouse = (e: MouseEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    };
    window.addEventListener('mousemove', onMouse);

    let raf = 0;
    const tick = () => {
      const rect = root.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height * 0.48;
      const dx = mouse.x - cx;
      const dy = mouse.y - cy;
      const dist = Math.hypot(dx, dy) || 1;
      const reach = Math.min(1, dist / 260);

      const targetX = (dx / dist) * reach * MAX_EYE_OFFSET;
      const targetY = (dy / dist) * reach * MAX_EYE_OFFSET;
      cur.ex += (targetX - cur.ex) * 0.12;
      cur.ey += (targetY - cur.ey) * 0.12;
      track.setAttribute('transform', `translate(${cur.ex.toFixed(2)} ${cur.ey.toFixed(2)})`);

      const targetRot = Math.max(
        -MAX_BODY_TILT,
        Math.min(MAX_BODY_TILT, (dx / (rect.width || 1)) * MAX_BODY_TILT),
      );
      cur.rot += (targetRot - cur.rot) * 0.07;
      tilt.setAttribute('transform', `rotate(${cur.rot.toFixed(2)} 100 160)`);

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('mousemove', onMouse);
    };
  }, []);

  return (
    <svg ref={rootRef} viewBox="0 0 200 200" width={size} height={size} aria-hidden className="qb">
      <defs>
        <radialGradient id={gradId} cx="36%" cy="30%" r="85%">
          <stop offset="0%" stopColor={pal.hi} />
          <stop offset="45%" stopColor={pal.mid} />
          <stop offset="100%" stopColor={pal.lo} />
        </radialGradient>
        <radialGradient id={shadowId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#000000" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0" />
        </radialGradient>
      </defs>

      <ellipse cx="100" cy="176" rx="62" ry="14" fill={`url(#${shadowId})`} />

      {/* body: subtle cursor tilt wraps the animated body group */}
      <g ref={tiltRef}>
        <g className={`qb-body ${bodyClass(mood)}`}>
          <circle cx="100" cy="96" r="78" fill={`url(#${gradId})`} />

          {/* eyes: cursor-tracking wrapper > optional orbit > blink */}
          <g ref={trackRef}>
            {mood === 'thinking' ? (
              <g className="qb-orbit">
                <CalmEyes mood={mood} />
              </g>
            ) : (
              faceFor(mood)
            )}
          </g>

          {mood === 'working' && <Sweat />}
        </g>
      </g>

      {mood === 'thinking' && <QuestionMark />}
    </svg>
  );
}

function faceFor(mood: BotMood) {
  switch (mood) {
    case 'working':
      return <FocusedEyes />;
    case 'error':
      return <AngryBrows />;
    case 'success':
      return <HappyEyes />;
    default:
      return <CalmEyes mood={mood} />;
  }
}

function bodyClass(mood: BotMood): string {
  switch (mood) {
    case 'working':
      return 'qb-working';
    case 'error':
      return 'qb-error';
    case 'thinking':
      return 'qb-thinking';
    case 'success':
      return 'qb-success';
    case 'waiting':
      return 'qb-waiting';
    default:
      return 'qb-idle';
  }
}

/** Vertical oval eyes — calm states. Blink comes via CSS; wandering via orbit. */
function CalmEyes({ mood }: { mood: BotMood }) {
  const ry = mood === 'success' ? 13 : 16;
  return (
    <g className="qb-eyes">
      <ellipse cx="82" cy={mood === 'thinking' ? 89 : 96} rx="9" ry={ry} fill="#17171a" />
      <ellipse cx="122" cy={mood === 'thinking' ? 89 : 96} rx="9" ry={ry} fill="#17171a" />
    </g>
  );
}

/** Straight brows + squinted eyes: deep in work, sweating — focused, not angry. */
function FocusedEyes() {
  return (
    <g>
      <rect x="64" y="74" width="34" height="9" rx="4.5" fill="#17171a" />
      <rect x="102" y="74" width="34" height="9" rx="4.5" fill="#17171a" />
      <g className="qb-focus qb-eyes">
        <ellipse cx="82" cy="98" rx="8" ry="10" fill="#17171a" />
        <ellipse cx="122" cy="98" rx="8" ry="10" fill="#17171a" />
      </g>
    </g>
  );
}

/** Slanted slab brows — reserved for genuine errors. */
function AngryBrows() {
  return (
    <g>
      <rect x="64" y="87" width="36" height="16" rx="8" fill="#17171a" transform="rotate(26 82 95)" />
      <rect x="100" y="87" width="36" height="16" rx="8" fill="#17171a" transform="rotate(-26 118 95)" />
    </g>
  );
}

/** Joyful ∩ arcs. */
function HappyEyes() {
  return (
    <g className="qb-eyes" fill="none" stroke="#17171a" strokeWidth="7" strokeLinecap="round">
      <path d="M71 99 q11 -14 22 0" />
      <path d="M111 99 q11 -14 22 0" />
    </g>
  );
}

/** Effort droplets flying off the head while working. */
function Sweat() {
  return (
    <g fill="#7ec8f7">
      <path className="qb-drop qb-drop-a" d="M0 -5 C3 -1.5 4.5 1 0 4.5 C-4.5 1 -3 -1.5 0 -5 Z" transform="translate(166 58)" />
      <path className="qb-drop qb-drop-b" d="M0 -5 C3 -1.5 4.5 1 0 4.5 C-4.5 1 -3 -1.5 0 -5 Z" transform="translate(34 70)" />
      <path className="qb-drop qb-drop-c" d="M0 -4.5 C2.7 -1.4 4 0.9 0 4 C-4 0.9 -2.7 -1.4 0 -4.5 Z" transform="translate(148 30)" />
    </g>
  );
}

/** Floating question mark while pondering. */
function QuestionMark() {
  return (
    <text className="qb-qmark" x="162" y="44" textAnchor="middle" fontSize="46" fontWeight="700">
      ?
    </text>
  );
}
