/** Minimal stroke icon set — no emoji anywhere in the UI. */

export type IconName =
  | 'general'
  | 'providers'
  | 'agents'
  | 'skills'
  | 'plugins'
  | 'integrations'
  | 'themes'
  | 'about'
  | 'sun'
  | 'moon'
  | 'gear'
  | 'terminal'
  | 'file'
  | 'filePlus'
  | 'pen'
  | 'search'
  | 'list'
  | 'globe'
  | 'camera';

const PATHS: Record<IconName, React.ReactNode> = {
  // sliders / gear-ish for general
  general: (
    <>
      <line x1="4" y1="7" x2="20" y2="7" />
      <circle cx="9" cy="7" r="2.2" fill="none" />
      <line x1="4" y1="15" x2="20" y2="15" />
      <circle cx="15" cy="15" r="2.2" fill="none" />
    </>
  ),
  // lightning bolt for providers
  providers: <path d="M13 3 L6 13 h5 l-1 8 7 -11 h-5 z" fill="none" strokeLinejoin="round" />,
  // robot head
  agents: (
    <>
      <rect x="5" y="8" width="14" height="10" rx="2.5" fill="none" />
      <circle cx="9.5" cy="13" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="13" r="1.1" fill="currentColor" stroke="none" />
      <line x1="12" y1="8" x2="12" y2="5" />
      <circle cx="12" cy="4.2" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  // puzzle piece
  skills: (
    <path
      d="M9.5 5 h4 v2.2 a1.8 1.8 0 1 0 3.6 0 V5 H19 v4.2 h-2.2 a1.8 1.8 0 1 0 0 3.6 H19 V19 h-9.5 v-2.2 a1.8 1.8 0 1 0 -3.6 0 V19 H4.5 v-4.2 h2.2 a1.8 1.8 0 1 0 0 -3.6 H4.5 V5 z"
      fill="none"
      strokeLinejoin="round"
    />
  ),
  // cube for plugins
  plugins: (
    <>
      <path d="M12 3 L20 7.2 v9 L12 21 4 16.2 v-9 Z" fill="none" strokeLinejoin="round" />
      <path d="M4 7.2 L12 11.5 20 7.2 M12 11.5 V21" fill="none" />
    </>
  ),
  // chain link for integrations
  integrations: (
    <>
      <path d="M10.5 13.5 a3.5 3.5 0 0 0 5 0 l3 -3 a3.54 3.54 0 0 0 -5 -5 l-1.7 1.7" fill="none" />
      <path d="M13.5 10.5 a3.5 3.5 0 0 0 -5 0 l-3 3 a3.54 3.54 0 0 0 5 5 l1.7 -1.7" fill="none" />
    </>
  ),
  // palette-ish droplet+swatch for themes
  themes: (
    <>
      <circle cx="12" cy="12" r="8.5" fill="none" />
      <circle cx="9" cy="10" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15" cy="10" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="15.5" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  // info
  about: (
    <>
      <circle cx="12" cy="12" r="8.5" fill="none" />
      <line x1="12" y1="11" x2="12" y2="16" />
      <circle cx="12" cy="8" r="1.05" fill="currentColor" stroke="none" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" fill="none" />
      <line x1="12" y1="2.5" x2="12" y2="5" />
      <line x1="12" y1="19" x2="12" y2="21.5" />
      <line x1="2.5" y1="12" x2="5" y2="12" />
      <line x1="19" y1="12" x2="21.5" y2="12" />
      <line x1="5.3" y1="5.3" x2="7" y2="7" />
      <line x1="17" y1="17" x2="18.7" y2="18.7" />
      <line x1="5.3" y1="18.7" x2="7" y2="17" />
      <line x1="17" y1="7" x2="18.7" y2="5.3" />
    </>
  ),
  moon: <path d="M20 13.5 A8.5 8.5 0 1 1 10.5 4 A7 7 0 0 0 20 13.5 Z" fill="none" strokeLinejoin="round" />,
  gear: (
    <>
      <circle cx="12" cy="12" r="3.2" fill="none" />
      <path
        d="M12 3.5 l1.2 2.1 a6.8 6.8 0 0 1 2.1 0.87 l2.35 -0.63 2 3.46 -1.55 1.83 a6.9 6.9 0 0 1 0 1.74 l1.55 1.83 -2 3.46 -2.35 -0.63 a6.8 6.8 0 0 1 -2.1 0.87 L12 20.5 l-1.2 -2.1 a6.8 6.8 0 0 1 -2.1 -0.87 l-2.35 0.63 -2 -3.46 1.55 -1.83 a6.9 6.9 0 0 1 0 -1.74 L4.35 9.3 l2 -3.46 2.35 0.63 a6.8 6.8 0 0 1 2.1 -0.87 Z"
        fill="none"
        strokeLinejoin="round"
      />
    </>
  ),
  terminal: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" fill="none" />
      <path d="M7 9.5 L10.5 12.5 7 15.5 M12.5 16 H17" fill="none" />
    </>
  ),
  file: (
    <>
      <path d="M13.5 3 H7 a1.8 1.8 0 0 0 -1.8 1.8 V19.2 A1.8 1.8 0 0 0 7 21 h10 a1.8 1.8 0 0 0 1.8 -1.8 V8.3 Z" fill="none" strokeLinejoin="round" />
      <path d="M13.5 3 V8.3 H18.8" fill="none" strokeLinejoin="round" />
    </>
  ),
  filePlus: (
    <>
      <path d="M13.5 3 H7 a1.8 1.8 0 0 0 -1.8 1.8 V19.2 A1.8 1.8 0 0 0 7 21 h10 a1.8 1.8 0 0 0 1.8 -1.8 V8.3 Z" fill="none" strokeLinejoin="round" />
      <path d="M13.5 3 V8.3 H18.8 M12 12 v5 M9.5 14.5 h5" fill="none" strokeLinejoin="round" />
    </>
  ),
  pen: (
    <>
      <path d="M15.5 4.5 l4 4 L8 20 H4 v-4 Z" fill="none" strokeLinejoin="round" />
      <path d="M13.5 6.5 l4 4" fill="none" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" fill="none" />
      <line x1="15.8" y1="15.8" x2="20.5" y2="20.5" />
    </>
  ),
  list: (
    <>
      <line x1="9" y1="6.5" x2="19.5" y2="6.5" />
      <line x1="9" y1="12" x2="19.5" y2="12" />
      <line x1="9" y1="17.5" x2="19.5" y2="17.5" />
      <circle cx="4.8" cy="6.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="4.8" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="4.8" cy="17.5" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" fill="none" />
      <ellipse cx="12" cy="12" rx="3.6" ry="8.5" fill="none" />
      <line x1="3.5" y1="12" x2="20.5" y2="12" />
    </>
  ),
  camera: (
    <>
      <path d="M4 7.5 h11 a1.5 1.5 0 0 1 1.5 1.5 v8 a1.5 1.5 0 0 1 -1.5 1.5 H4 A1.5 1.5 0 0 1 2.5 17 V9 A1.5 1.5 0 0 1 4 7.5 Z M15.5 10.5 L21.5 7.5 V16.5 L15.5 13.5 Z" fill="none" strokeLinejoin="round" />
      <circle cx="9" cy="13" r="2.6" fill="none" />
    </>
  ),
};

interface Props {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 16 }: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      aria-hidden
    >
      {PATHS[name]}
    </svg>
  );
}
