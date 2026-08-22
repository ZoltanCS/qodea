export type ShapeId =
  | 'circle'
  | 'pebble'
  | 'squircle'
  | 'capsule'
  | 'triangle'
  | 'hexagon'
  | 'cloud'
  | 'droplet';

export type FaceId =
  | 'neutral'
  | 'attentive'
  | 'surprised'
  | 'excited'
  | 'happy'
  | 'laughing'
  | 'angry'
  | 'sad'
  | 'scared'
  | 'suspicious'
  | 'confused'
  | 'curious'
  | 'proud'
  | 'shy'
  | 'unimpressed'
  | 'sleepy';

export interface AvatarCfg {
  shape: ShapeId;
  face: FaceId;
  color: string;
}

export const SHAPES: Array<{ id: ShapeId; label: string }> = [
  { id: 'circle', label: 'Kör' },
  { id: 'pebble', label: 'Kavics' },
  { id: 'squircle', label: 'Squircle' },
  { id: 'capsule', label: 'Kapszula' },
  { id: 'triangle', label: 'Háromszög' },
  { id: 'hexagon', label: 'Hexagon' },
  { id: 'cloud', label: 'Felhő' },
  { id: 'droplet', label: 'Csepp' },
];

export const FACES: Array<{ id: FaceId; label: string }> = [
  { id: 'neutral', label: 'Semleges' },
  { id: 'attentive', label: 'Figyelmes' },
  { id: 'surprised', label: 'Meglepett' },
  { id: 'excited', label: 'Izgatott' },
  { id: 'happy', label: 'Boldog' },
  { id: 'laughing', label: 'Nevető' },
  { id: 'angry', label: 'Dühös' },
  { id: 'sad', label: 'Szomorú' },
  { id: 'scared', label: 'Megrémült' },
  { id: 'suspicious', label: 'Gyanakvó' },
  { id: 'confused', label: 'Zavarodott' },
  { id: 'curious', label: 'Kíváncsi' },
  { id: 'proud', label: 'Büszke' },
  { id: 'shy', label: 'Szégyenlős' },
  { id: 'unimpressed', label: 'Impresszmentes' },
  { id: 'sleepy', label: 'Álmos' },
];

export const COLORS = [
  '#15151a',
  '#8a5a34',
  '#e2503c',
  '#f08b1f',
  '#eec93d',
  '#3fae6a',
  '#39b8a0',
  '#3d8bfd',
  '#8a63e8',
  '#e05fc0',
  '#9aa0a6',
  '#f4f2ec',
];

export const DEFAULT_AVATAR: AvatarCfg = {
  shape: 'circle',
  face: 'neutral',
  color: '#e2503c',
};

const KEY = 'qodea-avatar';

export function loadAvatar(): AvatarCfg {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_AVATAR;
    const parsed = JSON.parse(raw) as Partial<AvatarCfg>;
    const validShape = SHAPES.some((s) => s.id === parsed.shape);
    const validFace = FACES.some((f) => f.id === parsed.face);
    return {
      shape: validShape ? (parsed.shape as ShapeId) : DEFAULT_AVATAR.shape,
      face: validFace ? (parsed.face as FaceId) : DEFAULT_AVATAR.face,
      color:
        typeof parsed.color === 'string' && /^#[0-9a-f]{6}$/i.test(parsed.color)
          ? parsed.color
          : DEFAULT_AVATAR.color,
    };
  } catch {
    return DEFAULT_AVATAR;
  }
}

export function saveAvatar(cfg: AvatarCfg): void {
  localStorage.setItem(KEY, JSON.stringify(cfg));
}

/* ── color helpers ── */

function clamp(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function shift(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp(((n >> 16) & 255) * amt);
  const g = clamp(((n >> 8) & 255) * amt);
  const b = clamp((n & 255) * amt);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export function lighten(hex: string): string {
  return shift(hex, 1.45 + (1 - lum(hex)) * 0.25);
}

export function darken(hex: string): string {
  return shift(hex, 0.55);
}

export function lum(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return (
    (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255
  );
}

export function faceColor(bodyHex: string): string {
  return lum(bodyHex) < 0.42 ? '#f2f0ea' : '#17171a';
}
