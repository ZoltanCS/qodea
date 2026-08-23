import { Avatar } from '../avatar/Avatar';
import type { AvatarCfg } from '../avatar/avatarConfig';
import type { ChatItem, DeployedAgent } from '../chat/useChatSession';
import { Row } from '../chat/messageViews';

export interface PersonaInfo {
  id: string;
  label: string;
  color: string;
  face: string;
  desc: string;
}

const BUILTIN: PersonaInfo[] = [
  { id: 'explorer', label: 'Kódbázis felderítő', color: '#3d8bfd', face: 'curious', desc: 'feltérképezi a kódbázist' },
  { id: 'worker', label: 'Implementáló', color: '#3fae6a', face: 'proud', desc: 'kódot ír és módosít' },
  { id: 'reviewer', label: 'Reviewer', color: '#f08b1f', face: 'suspicious', desc: 'kritizál, hibákat keres' },
  { id: 'planner', label: 'Tervező', color: '#8a63e8', face: 'attentive', desc: 'lépésekre bontja a feladatot' },
  { id: 'tester', label: 'Teszter', color: '#e2503c', face: 'attentive', desc: 'teszteket futtat, elemzi' },
];

interface Props {
  deployed: DeployedAgent[];
  streams: Record<string, ChatItem[]>;
  openTabs: string[];
  activeTab: string;
  onActivate: (tabId: string) => void;
  onCloseTab: (id: string) => void;
}

function personaAvatar(color: string, face: string, size = 24): React.ReactNode {
  const cfg: AvatarCfg = {
    shape: 'circle',
    face: (face as AvatarCfg['face']) ?? 'neutral',
    color,
  };
  return <Avatar cfg={cfg} size={size} />;
}

export function AgentPanel(props: Props) {
  const running = props.deployed.filter((a) => a.status === 'running');
  const finished = props.deployed.filter((a) => a.status !== 'running');

  return (
    <aside className="right-panel">
      {/* tab strip */}
      <div className="rp-tabs">
        <button
          className={`rp-tab${props.activeTab === 'list' ? ' on' : ''}`}
          onClick={() => props.onActivate('list')}
        >
          Agentek
        </button>
        {props.openTabs.map((id) => {
          const agent = props.deployed.find((a) => a.id === id);
          if (!agent) return null;
          return (
            <button
              key={id}
              className={`rp-tab${props.activeTab === id ? ' on' : ''}`}
              onClick={() => props.onActivate(id)}
            >
              <span className="rt-dot" style={{ background: agent.color }} />
              <span className="rt-name">{agent.name}</span>
              <span
                className="rt-close"
                role="button"
                onClick={(e) => {
                  e.stopPropagation();
                  props.onCloseTab(id);
                }}
              >
                ×
              </span>
            </button>
          );
        })}
      </div>

      {/* content */}
      <div className="rp-content">
        {props.activeTab === 'list' ? (
          <>
            <SectionTitle>Futó / deployolt</SectionTitle>
            {running.length === 0 && finished.length === 0 && (
              <div className="rp-empty">Még nincs deployolt agent.</div>
            )}
            {[...running, ...finished].map((a) => (
              <AgentRow
                key={a.id}
                agent={a}
                onOpen={() => props.onActivate(a.id)}
                active={props.activeTab === a.id}
              />
            ))}

            <SectionTitle>Elérhető típusok</SectionTitle>
            <div className="rp-builtins">
              {BUILTIN.map((b) => (
                <div className="rp-builtin" key={b.id}>
                  <span className="rb-dot" style={{ background: b.color }} />
                  <span className="rb-nm">{b.label}</span>
                  <span className="rb-desc">{b.desc}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          (() => {
            const agent = props.deployed.find((a) => a.id === props.activeTab);
            if (!agent)
              return <div className="rp-empty">Ez az agent már nem elérhető.</div>;
            const streamItems = props.streams[agent.id] ?? [];
            return (
              <div className="rp-agent-view">
                <div className="rp-agent-head">
                  {personaAvatar(agent.color, agent.face, 34)}
                  <div className="ah-txt">
                    <strong>{agent.name}</strong>
                    <span className={agent.status}>
                      {agent.status === 'running'
                        ? 'dolgozik…'
                        : agent.status === 'error'
                          ? 'hiba'
                          : 'kész'}
                    </span>
                  </div>
                </div>
                <div className="rp-agent-stream">
                  {streamItems.length === 0 && (
                    <div className="rp-empty">Még nincs kimenet…</div>
                  )}
                  {streamItems.map((it) => (
                    <Row key={it.id} item={it} />
                  ))}
                </div>
              </div>
            );
          })()
        )}
      </div>
    </aside>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="rp-sec">{children}</div>;
}

function AgentRow({
  agent,
  onOpen,
  active,
}: {
  agent: DeployedAgent;
  onOpen: () => void;
  active: boolean;
}) {
  return (
    <button className={`ag-row${active ? ' on' : ''}`} onClick={onOpen} title={agent.task}>
      <span className="ag-ava">
        {personaAvatar(agent.color, agent.face, 26)}
        <span className={`ag-dot ${agent.status}`} />
      </span>
      <span className="ag-info">
        <span className="ag-name">{agent.name}</span>
        <span className="ag-status">
          {agent.status === 'running'
            ? 'fut…'
            : agent.status === 'error'
              ? 'hiba'
              : 'kész'}
        </span>
      </span>
    </button>
  );
}
