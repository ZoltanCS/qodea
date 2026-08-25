import { useState } from 'react';
import { Avatar } from './Avatar';
import {
  COLORS,
  FACES,
  SHAPES,
  type AvatarCfg,
} from './avatarConfig';

interface Props {
  initial: AvatarCfg;
  /** called (debounced) on every change — parent persists live */
  onSave: (cfg: AvatarCfg) => void;
}

export function AvatarEditor({ initial, onSave }: Props) {
  const [cfg, setCfg] = useState<AvatarCfg>(initial);
  const [tab, setTab] = useState<'look' | 'move'>('move');

  const surprise = () => {
    const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)]!;
    setCfg({
      shape: pick(SHAPES).id,
      face: pick(FACES).id,
      color: pick(COLORS),
    });
  };

  return (
    <div className="p-body">
      {/* live preview */}
      <div className="p-left">
        <Avatar cfg={cfg} size={230} animate={tab === 'move'} />
        <span className="p-note">
          {tab === 'move' ? 'A kurzort követi és lélegzik.' : 'Statikus nézet.'}
        </span>
        <div className="p-actions">
          <button className="btn primary" onClick={() => onSave(cfg)} title="Alkalmaz és bezár">
            Save
          </button>
          <button className="btn" onClick={surprise} title="Véletlen kombináció">
            Lépj meg
          </button>
        </div>
      </div>

      {/* options */}
      <div className="p-right">
        <div className="seg uimode p-tabs">
          <button className={tab === 'look' ? 'on' : ''} onClick={() => setTab('look')}>
            Look
          </button>
          <button className={tab === 'move' ? 'on' : ''} onClick={() => setTab('move')}>
            Move
          </button>
        </div>

        <h3 className="p-h">Forma</h3>
        <div className="opt-grid">
          {SHAPES.map((s) => (
            <PreviewOpt
              key={s.id}
              label={s.label}
              on={cfg.shape === s.id}
              onClick={() => setCfg({ ...cfg, shape: s.id })}
            >
              <Avatar cfg={{ ...cfg, shape: s.id }} size={44} />
            </PreviewOpt>
          ))}
        </div>

        <h3 className="p-h">Face</h3>
        <div className="opt-grid">
          {FACES.map((f) => (
            <PreviewOpt
              key={f.id}
              label={f.label}
              on={cfg.face === f.id}
              onClick={() => setCfg({ ...cfg, face: f.id })}
            >
              <Avatar cfg={{ ...cfg, face: f.id }} size={44} />
            </PreviewOpt>
          ))}
        </div>

        <h3 className="p-h">Color</h3>
        <div className="swatches">
          {COLORS.map((c) => (
            <button
              key={c}
              className={`swatch${cfg.color.toLowerCase() === c.toLowerCase() ? ' on' : ''}`}
              style={{ background: c }}
              onClick={() => setCfg({ ...cfg, color: c })}
              aria-label={c}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function PreviewOpt({
  label,
  on,
  onClick,
  children,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button className={`opt${on ? ' on' : ''}`} onClick={onClick}>
      {children}
      <span>{label}</span>
    </button>
  );
}
