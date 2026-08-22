import { useMemo, useState } from 'react';
import type { SessionSummary } from '../ipc.d';
import { QodeaBot } from '../mascot/QodeaBot';
import { Settings } from '../settings/Settings';

interface SidebarProps {
  sessions: SessionSummary[];
  activeSessionId: string | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onNewChat: () => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  settingsOpen: boolean;
  onCloseSettings: () => void;
}

interface Project {
  name: string;
  cwd: string | null;
  sessions: SessionSummary[];
}

function projectName(cwd: string | null): string {
  if (!cwd || !cwd.trim()) return 'Névtelen projekt';
  const norm = cwd.replace(/[\\/]+$/, '');
  return norm.split(/[\\/]/).pop() || norm;
}

export function Sidebar(props: SidebarProps) {
  return (
    <aside className="side">
      <div className="side-top">
        <button className="new-chat" onClick={props.onNewChat} title="Új beszélgetés">
          + Új beszélgetés
        </button>
      </div>

      {props.settingsOpen ? (
        <div className="side-settings">
          <Settings
            compact
            onClose={() => {
              props.onCloseSettings();
            }}
          />
        </div>
      ) : (
        <SessionTree {...props} />
      )}

      <div className="side-bottom">
        <button
          className={`side-row settings-link${props.settingsOpen ? ' on' : ''}`}
          onClick={() => props.onCloseSettings()}
        >
          <span className="ic">⚙</span> Beállítások
        </button>
        <div className="account">
          <QodeaBot mood="idle" color="cream" size={26} />
          <span className="acc-name">Zoltán</span>
          <span className="spacer" />
          <button
            className="mini-ic"
            title={props.theme === 'dark' ? 'Világos mód' : 'Sötét mód'}
            onClick={props.onToggleTheme}
          >
            {props.theme === 'dark' ? '☀' : '☾'}
          </button>
        </div>
      </div>
    </aside>
  );
}

function SessionTree({ sessions, activeSessionId, onOpen, onDelete }: SidebarProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const projects = useMemo<Project[]>(() => {
    const map = new Map<string, Project>();
    for (const s of [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)) {
      const key = s.cwd?.trim() || '__none__';
      let p = map.get(key);
      if (!p) {
        p = { name: projectName(s.cwd), cwd: s.cwd, sessions: [] };
        map.set(key, p);
      }
      p.sessions.push(s);
    }
    return [...map.values()];
  }, [sessions]);

  if (projects.length === 0) {
    return (
      <div className="tree">
        <div className="tree-empty">Még nincs beszélgetés.<br />Indíts egyet jobbra! 👋</div>
      </div>
    );
  }

  return (
    <nav className="tree">
      {projects.map((p) => {
        const key = p.cwd ?? '__none__';
        const isCollapsed = collapsed[key] ?? false;
        return (
          <div className="proj" key={key}>
            <button
              className="proj-head"
              onClick={() => setCollapsed((c) => ({ ...c, [key]: !isCollapsed }))}
              title={p.cwd ?? ''}
            >
              <span className={`chev${isCollapsed ? ' closed' : ''}`}>▾</span>
              <span className="f-ic">▸</span>
              <span className="nm">{p.name}</span>
            </button>

            {!isCollapsed && (
              <div className="sess-list">
                {p.sessions.map((s) => (
                  <div
                    key={s.id}
                    className={`sess-row${s.id === activeSessionId ? ' on' : ''}`}
                    onClick={() => onOpen(s.id)}
                    title={`${s.title}\n${new Date(s.updatedAt).toLocaleString('hu-HU')}`}
                  >
                    <span className="f-ic-file"></span>
                    <span className="t">{s.title}</span>
                    <button
                      className="del"
                      title="Törlés"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(s.id);
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
