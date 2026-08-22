import { useEffect, useId, useRef, useState } from 'react';
import {
  type AvatarCfg,
  darken,
  faceColor,
  lighten,
} from './avatarConfig';

interface AvatarProps {
  cfg: AvatarCfg;
  size?: number;
  /** breathe + subtle cursor tracking */
  animate?: boolean;
}

/* ── liquid morphing ───────────────────────────────────────────────────────
   Every shape is a polar outline sampled at K points; switching shapes
   lerps point-by-point through a Catmull-Rom spline → gooey transition.   */

const K = 56;
const TAU = Math.PI * 2;

type Pt = { x: number; y: number };

function pt(r: number, t: number): Pt {
  return { x: 100 + r * Math.cos(t), y: 100 + r * Math.sin(t) };
}

/** regular m-gon radius with slight circle blend for softness */
function polyR(m: number, apothem: number, t: number, mixC: number): number {
  const seg = TAU / m;
  const a = (((t + Math.PI / 2) % seg) + seg) % seg - seg / 2;
  return (apothem / Math.cos(a)) * (1 - mixC) + 78 * mixC;
}

const PROFILES: Record<AvatarCfg['shape'], (t: number) => Pt> = {
  circle: (t) => pt(78, t),
  pebble: (t) =>
    pt(77 * (1 + 0.05 * Math.sin(2 * t + 0.9) + 0.035 * Math.sin(3 * t + 2.2) + 0.02 * Math.cos(5 * t)), t),
  squircle: (t) => {
    const p = 4.5;
    const c = Math.abs(Math.cos(t));
    const s = Math.abs(Math.sin(t));
    return pt(82 / Math.pow(Math.pow(c, p) + Math.pow(s, p), 1 / p), t);
  },
  capsule: (t) => {
    const p = 2.3;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const r = 82 / Math.pow(Math.pow(Math.abs(c), p) + Math.pow(Math.abs(s), p), 1 / p);
    return { x: 100 + r * c * 0.72, y: 100 + r * s * 1.08 };
  },
  triangle: (t) => pt(polyR(3, 46, t, 0.15), t),
  hexagon: (t) => pt(polyR(6, 74, t, 0.14), t),
  cloud: (t) => {
    const p = pt(
      76 * (1 + 0.09 * Math.sin(2 * t - 0.5) + 0.06 * Math.sin(3 * t + 1.2) + 0.035 * Math.sin(5 * t + 2.6)),
      t,
    );
    p.y -= 5;
    return p;
  },
  droplet: (t) => {
    const s = Math.sin(t);
    const p = pt(78 * (0.6 + 0.4 * Math.pow((s + 1) / 2, 1.5)), t);
    p.y += 12;
    return p;
  },
};

function samplePoints(shape: AvatarCfg['shape']): Pt[] {
  const fn = PROFILES[shape];
  const pts: Pt[] = [];
  for (let i = 0; i < K; i++) pts.push(fn((i / K) * TAU));
  return pts;
}

/** closed Catmull-Rom spline → cubic bezier path */
function toPath(pts: Pt[]): string {
  let d = `M ${pts[0]!.x.toFixed(2)} ${pts[0]!.y.toFixed(2)} `;
  for (let i = 0; i < K; i++) {
    const p0 = pts[(i - 1 + K) % K]!;
    const p1 = pts[i]!;
    const p2 = pts[(i + 1) % K]!;
    const p3 = pts[(i + 2) % K]!;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += `C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)} `;
  }
  return d + 'Z';
}

/* ── face variants ── */

function Face({ face, col }: { face: AvatarCfg['face']; col: string }) {
  const eye = (cx: number, cy: number, rx: number, ry?: number) => (
    <ellipse key={`${cx}-${cy}`} cx={cx} cy={cy} rx={rx} ry={ry ?? rx} fill={col} />
  );
  const arc = (d: string, w = 7) => (
    <path d={d} stroke={col} strokeWidth={w} strokeLinecap="round" fill="none" />
  );

  switch (face) {
    case 'neutral':
      return <g>{eye(82, 96, 9, 15)}{eye(122, 96, 9, 15)}</g>;
    case 'attentive':
      return <g>{eye(82, 90, 8, 16)}{eye(122, 90, 8, 16)}</g>;
    case 'surprised':
      return <g>{eye(82, 94, 11)}{eye(122, 94, 11)}</g>;
    case 'excited':
      return (
        <g>
          {eye(82, 92, 12)}
          {eye(122, 92, 12)}
          <circle cx="86" cy="87" r="3.5" fill="#ffffff" opacity="0.85" />
          <circle cx="126" cy="87" r="3.5" fill="#ffffff" opacity="0.85" />
        </g>
      );
    case 'happy':
      return <g>{arc('M71 100 Q82 87 93 100')}{arc('M111 100 Q122 87 133 100')}</g>;
    case 'laughing':
      return (
        <g>
          {arc('M69 95 Q80 84 91 96', 6)}
          {arc('M113 96 Q124 84 135 95', 6)}
        </g>
      );
    case 'angry':
      return (
        <g>
          <rect x="64" y="87" width="36" height="15" rx="7.5" fill={col} transform="rotate(26 82 94)" />
          <rect x="100" y="87" width="36" height="15" rx="7.5" fill={col} transform="rotate(-26 118 94)" />
        </g>
      );
    case 'sad':
      return (
        <g>
          {arc('M71 97 Q81 104 92 99')}
          {arc('M112 99 Q123 104 133 97')}
        </g>
      );
    case 'scared':
      return <g>{eye(76, 88, 8)}{eye(128, 88, 8)}{eye(82, 106, 6)}{eye(122, 106, 6)}</g>;
    case 'suspicious':
      return (
        <g>
          <rect x="68" y="92" width="28" height="9" rx="4.5" fill={col} transform="rotate(8 82 96)" />
          <rect x="104" y="92" width="28" height="9" rx="4.5" fill={col} transform="rotate(-8 118 96)" />
        </g>
      );
    case 'confused':
      return <g>{eye(80, 92, 9, 14)}{eye(124, 102, 7)}</g>;
    case 'curious':
      return <g>{eye(82, 86, 9, 13)}{eye(122, 100, 9, 11)}</g>;
    case 'proud':
      return <g>{eye(82, 96, 13, 6)}{eye(122, 96, 13, 6)}</g>;
    case 'shy':
      return <g>{eye(78, 102, 7, 9)}{eye(118, 102, 7, 9)}</g>;
    case 'unimpressed':
      return (
        <g>
          <rect x="67" y="93" width="30" height="7" rx="3.5" fill={col} />
          <rect x="103" y="93" width="30" height="7" rx="3.5" fill={col} />
        </g>
      );
    case 'sleepy':
      return <g>{arc('M72 96 Q82 105 92 96', 6)}{arc('M112 96 Q122 105 132 96', 6)}</g>;
  }
}

export function Avatar({ cfg, size = 64, animate = false }: AvatarProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const gradId = `av-g-${uid}`;
  const shadowId = `av-s-${uid}`;

  const rootRef = useRef<SVGSVGElement>(null);
  const trackRef = useRef<SVGGElement>(null);

  // ── liquid shape morph state ──
  const [dAttr, setDAttr] = useState<string>(() => toPath(samplePoints(cfg.shape)));
  const curPtsRef = useRef<Pt[]>(samplePoints(cfg.shape));
  const shapeRef = useRef<AvatarCfg['shape']>(cfg.shape);
  const rafRef = useRef(0);

  useEffect(() => {
    if (cfg.shape === shapeRef.current) return;
    const from = curPtsRef.current.map((p) => ({ ...p }));
    const to = samplePoints(cfg.shape);
    shapeRef.current = cfg.shape;

    const DURATION = 520;
    const start = performance.now();
    cancelAnimationFrame(rafRef.current);

    const tick = (now: number) => {
      const raw = Math.min(1, (now - start) / DURATION);
      const p = 1 - Math.pow(1 - raw, 3); // easeOutCubic
      const jelly = 1 + 0.07 * Math.sin(raw * Math.PI); // gooey overshoot mid-way

      const cur: Pt[] = new Array(K);
      for (let i = 0; i < K; i++) {
        const x = from[i]!.x + (to[i]!.x - from[i]!.x) * p;
        const y = from[i]!.y + (to[i]!.y - from[i]!.y) * p;
        cur[i] = { x: 100 + (x - 100) * jelly, y: 100 + (y - 100) * jelly };
      }
      curPtsRef.current = cur;
      setDAttr(toPath(cur));
      if (raw < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [cfg.shape]);

  // ── optional breathing + cursor tracking ──
  useEffect(() => {
    if (!animate) return;
    const root = rootRef.current;
    const track = trackRef.current;
    if (!root || !track) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const mouse = { x: 0, y: 0 };
    const cur = { x: 0, y: 0 };
    const onMouse = (e: MouseEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    };
    window.addEventListener('mousemove', onMouse);

    let raf = 0;
    const tick = () => {
      const rect = root.getBoundingClientRect();
      if (rect.width > 0) {
        const dx = mouse.x - (rect.left + rect.width / 2);
        const dy = mouse.y - (rect.top + rect.height * 0.48);
        const dist = Math.hypot(dx, dy) || 1;
        const reach = Math.min(1, dist / 260);
        cur.x += ((dx / dist) * reach * 5 - cur.x) * 0.1;
        cur.y += ((dy / dist) * reach * 5 - cur.y) * 0.1;
        track.setAttribute('transform', `translate(${cur.x.toFixed(2)} ${cur.y.toFixed(2)})`);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('mousemove', onMouse);
    };
  }, [animate]);

  const hi = lighten(cfg.color);
  const lo = darken(cfg.color);
  const fCol = faceColor(cfg.color);

  return (
    <svg ref={rootRef} viewBox="0 0 200 200" width={size} height={size} aria-hidden className="avatar">
      <defs>
        <radialGradient id={gradId} cx="36%" cy="30%" r="85%">
          <stop offset="0%" stopColor={hi} />
          <stop offset="45%" stopColor={cfg.color} />
          <stop offset="100%" stopColor={lo} />
        </radialGradient>
        <radialGradient id={shadowId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#000000" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0" />
        </radialGradient>
      </defs>

      <ellipse cx="100" cy="178" rx="60" ry="13" fill={`url(#${shadowId})`} />

      <g className={animate ? 'av-breathe' : ''}>
        <path d={dAttr} fill={`url(#${gradId})`} />
        <g ref={trackRef}>
          <Face face={cfg.face} col={fCol} />
        </g>
      </g>
    </svg>
  );
}
