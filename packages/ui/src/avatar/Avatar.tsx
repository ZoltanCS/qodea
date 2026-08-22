import { useEffect, useId, useRef } from 'react';
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

/** Shape body element(s) — single fill color so overlaps merge invisibly. */
function Body({ shape, fill }: { shape: AvatarCfg['shape']; fill: string }) {
  switch (shape) {
    case 'circle':
      return <circle cx="100" cy="100" r="78" fill={fill} />;
    case 'pebble':
      return (
        <path
          d="M102 20 C150 20 176 54 175 98 C174 146 144 180 99 179 C52 178 25 146 25 101 C25 55 56 20 102 20 Z"
          fill={fill}
        />
      );
    case 'squircle':
      return <rect x="26" y="24" width="148" height="152" rx="46" fill={fill} />;
    case 'capsule':
      return <rect x="42" y="18" width="116" height="164" rx="58" fill={fill} />;
    case 'triangle':
      return (
        <path
          d="M100 30 L166 156 L34 156 Z"
          fill={fill}
          stroke={fill}
          strokeWidth="26"
          strokeLinejoin="round"
        />
      );
    case 'hexagon': {
      const pts = [
        [100, 22],
        [167, 61],
        [167, 139],
        [100, 178],
        [33, 139],
        [33, 61],
      ];
      return (
        <path
          d={`M${pts.map((p) => p.join(' ')).join(' L')} Z`}
          fill={fill}
          stroke={fill}
          strokeWidth="22"
          strokeLinejoin="round"
        />
      );
    }
    case 'cloud':
      return (
        <g fill={fill}>
          <circle cx="70" cy="112" r="46" />
          <circle cx="130" cy="110" r="44" />
          <circle cx="101" cy="84" r="42" />
          <circle cx="60" cy="134" r="28" />
          <circle cx="142" cy="132" r="27" />
        </g>
      );
    case 'droplet':
      return (
        <path
          d="M100 20 C138 68 168 104 168 133 A68 66 0 0 1 32 133 C32 104 62 68 100 20 Z"
          fill={fill}
        />
      );
  }
}

/** Eye/face variants. All positioned for a ~200x200 viewBox head centered on (100,100). */
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
        <Body shape={cfg.shape} fill={`url(#${gradId})`} />
        <g ref={trackRef}>{<Face face={cfg.face} col={fCol} />}</g>
      </g>
    </svg>
  );
}
