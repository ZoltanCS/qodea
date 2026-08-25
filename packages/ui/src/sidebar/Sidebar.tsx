import { useMemo, useState } from 'react';
import type { SessionSummary, ProjectInfo } from '../ipc.d';
import { Avatar } from '../avatar/Avatar';
import type { AvatarCfg } from '../avatar/avatarConfig';
import { Icon } from '../ui/Icon';

interface SidebarProps {
  sessions: SessionSummary[];
  projects: ProjectInfo[];
  activeSessionId: string | null;
  avatar: AvatarCfg;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onNewChat: () => void;
  onAddProject: () => void;
  onBrainstorm?: () => void;
  onNewChatInProject: (cwd: string) => void;
  theme: 'dark' | 'nord' | 'light';
  onToggleTheme: () => void;
  settingsOpen: boolean;
  onToggleSettings: () => void;
  onCloseSettings: () => void;
  onOpenAccount: () => void;
}

function projectName(cwd: string): string {
  const norm = cwd.replace(/[\\/]+$/, '');
  return norm.split(/[\\/]/).pop() || norm;
}

export function Sidebar(props: SidebarProps) {
  return (
    <aside className="side">
      <div className="side-top">
        <button className="new-chat primary" onClick={props.onNewChat} title="Új beszélgetés">
          + Új feladat
        </button>
        <button className="new-chat" onClick={() => void props.onAddProject()} title="Projekt mappa megnyitása">
          Új projekt
        </button>
        <button className="new-chat brainstorm" onClick={() => props.onBrainstorm?.()} title="Brainstorm — tervezzük meg együtt">
          Brainstorm
        </button>
      </div>

      <SessionTree {...props} />

      <div className="side-bottom">
        <button
          className={`side-row settings-link${props.settingsOpen ? ' on' : ''}`}
          onClick={props.onToggleSettings}
        >
          <span className="ic"><Icon name="gear" size={14} /></span> Beállítások
        </button>
        <div className="account" onClick={props.onOpenAccount} role="button" title="Profil és avatar">
          <Avatar cfg={props.avatar} size={28} />
          <span className="acc-name">Zoltán</span>
          <span className="spacer" />
          <button
            className="mini-ic"
            title={props.theme === 'dark' ? 'Világos mód' : 'Sötét mód'}
            onClick={(e) => {
              e.stopPropagation();
              props.onToggleTheme();
            }}
          >
            <Icon name={props.theme === 'dark' ? 'sun' : 'moon'} size={14} />
          </button>
        </div>
      </div>
    </aside>
  );
}

function SessionTree({
  sessions,
  projects,
  activeSessionId,
  onOpen,
  onDelete,
  onNewChatInProject,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // sessions grouped by cwd; stored projects always shown (even when empty)
  const groups = useMemo(() => {
    const byCwd = new Map<string, SessionSummary[]>();
    for (const s of [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)) {
      const key = s.cwd?.trim() ?? '';
      const list = byCwd.get(key) ?? [];
      list.push(s);
      byCwd.set(key, list);
    }

    const usedCwds = new Set<string>();
    const projectGroups = projects.map((p) => {
      usedCwds.add(p.cwd.toLowerCase());
      return {
        key: p.cwd,
        name: p.name,
        cwd: p.cwd,
        sessions: byCwd.get(p.cwd) ?? [],
      };
    });

    // session cwds that have no stored project → their own groups
    const extras = [...byCwd.entries()]
      .filter(([cwd]) => !usedCwds.has(cwd.toLowerCase()))
      .map(([cwd, sess]) => ({
        key: cwd || '__none__',
        name: projectName(cwd || ''),
        cwd,
        sessions: sess,
      }));

    return [...projectGroups, ...extras];
  }, [sessions, projects]);

  if (groups.length === 0) {
    return (
      <div className="tree">
        <div className="tree-empty">
          Még nincs beszélgetés.<br />Indíts egyet, vagy nyiss meg egy projektet!
        </div>
      </div>
    );
  }

  return (
    <nav className="tree">
      {groups.map((g) => {
        const isCollapsed = collapsed[g.key] ?? false;
        return (
          <div className="proj" key={g.key}>
            <div className={`proj-head${isCollapsed ? ' closed-row' : ''}`}>
              <button
                className="proj-title"
                onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !isCollapsed }))}
                title={g.cwd}
              >
                <span className={`chev${isCollapsed ? ' closed' : ''}`}>▾</span>
                <span className="f-ic">▸</span>
                <span className="nm">{g.name}</span>
                {g.sessions.length > 0 && <span className="count">{g.sessions.length}</span>}
              </button>
              <button
                className="add-chat"
                title="Új chat ebben a projektben"
                onClick={() => onNewChatInProject(g.cwd)}
              >
                +
              </button>
            </div>

            {!isCollapsed && (
              <div className="sess-list">
                {g.sessions.length === 0 && (
                  <div className="sess-empty">(még nincs chat)</div>
                )}
                {g.sessions.map((s) => (
                  <div
                    key={s.id}
                    className={`sess-row${s.id === activeSessionId ? ' on' : ''}`}
                    onClick={() => onOpen(s.id)}
                    title={`${s.title}\n${new Date(s.updatedAt).toLocaleString('hu-HU')}`}
                  >
                    <span className="f-file"></span>
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
