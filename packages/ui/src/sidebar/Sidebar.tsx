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
  onHideProject: (id: string) => void;
  onBrainstorm?: () => void;
  onNewChatInProject: (cwd: string) => void;
  theme: 'dark' | 'oled' | 'nord' | 'light';
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
        <button className="new-chat primary" onClick={props.onNewChat} title="New task">
          + New task
        </button>
        <button className="new-chat" onClick={() => void props.onAddProject()} title="Open project folder">
          New project
        </button>
        <button className="new-chat brainstorm" onClick={() => props.onBrainstorm?.()} title="Brainstorm — design it together">
          Brainstorm
        </button>
      </div>

      <SessionTree {...props} />

      <div className="side-bottom">
        <button
          className={`side-row settings-link${props.settingsOpen ? ' on' : ''}`}
          onClick={props.onToggleSettings}
        >
          <span className="ic"><Icon name="gear" size={14} /></span> Settings
        </button>
        <div className="account" onClick={props.onOpenAccount} role="button" title="Profile & avatar">
          <Avatar cfg={props.avatar} size={28} />
          <span className="acc-name">Zoltán</span>
          <span className="spacer" />
          <button
            className="mini-ic"
            title="Toggle theme"
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
  onHideProject,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // sessions grouped by cwd; hidden projects excluded; stored projects shown even when empty
  const groups = useMemo(() => {
    const byCwd = new Map<string, SessionSummary[]>();
    for (const s of [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)) {
      const key = s.cwd?.trim() ?? '';
      const list = byCwd.get(key) ?? [];
      list.push(s);
      byCwd.set(key, list);
    }

    const visibleProjects = projects.filter((p) => !p.hidden);
    const hiddenCwds = new Set(
      projects.filter((p) => p.hidden).map((p) => p.cwd.toLowerCase()),
    );

    const usedCwds = new Set<string>();
    const projectGroups = visibleProjects.map((p) => {
      usedCwds.add(p.cwd.toLowerCase());
      return {
        key: p.cwd,
        id: p.id,
        name: p.name,
        cwd: p.cwd,
        sessions: byCwd.get(p.cwd) ?? [],
      };
    });

    // session cwds with no visible project → their own groups (hidden-project cwds excluded)
    const extras = [...byCwd.entries()]
      .filter(
        ([cwd]) => cwd !== '' && !hiddenCwds.has(cwd.toLowerCase()) && !usedCwds.has(cwd.toLowerCase()),
      )
      .map(([cwd, sess]) => ({
        key: cwd,
        id: null,
        name: projectName(cwd),
        cwd,
        sessions: sess,
      }));

    return [...projectGroups, ...extras];
  }, [sessions, projects]);

  if (groups.length === 0) {
    return (
      <div className="tree">
        <div className="tree-empty">
          No conversations yet.<br />Start one or open a project!
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
                className="hide-proj"
                title="Hide project (stays on disk)"
                onClick={() => g.id && onHideProject(g.id)}
              >
                <Icon name="eyeOff" size={13} />
              </button>
              <button
                className="add-chat"
                title="New chat in this project"
                onClick={() => onNewChatInProject(g.cwd)}
              >
                +
              </button>
            </div>

            {!isCollapsed && (
              <div className="sess-list">
                {g.sessions.length === 0 && (
                  <div className="sess-empty">(no chats yet)</div>
                )}
                {g.sessions.map((s) => (
                  <div
                    key={s.id}
                    className={`sess-row${s.id === activeSessionId ? ' on' : ''}`}
                    onClick={() => onOpen(s.id)}
                    title={`${s.title}\n${new Date(s.updatedAt).toLocaleString('en-US')}`}
                  >
                    <span className="f-file"></span>
                    <span className="t">{s.title}</span>
                    <button
                      className="del"
                      title="Remove"
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
