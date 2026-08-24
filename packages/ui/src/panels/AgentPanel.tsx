import { Avatar } from '../avatar/Avatar';
import type { AvatarCfg } from '../avatar/avatarConfig';
import type { ChatItem, DeployedAgent, ExtraTab } from '../chat/useChatSession';
import type { LifetimeStats } from '../ipc.d';
import { estimateCost } from '../ui/pricing';
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
  { id: 'netlord', label: 'Netlord', color: '#39b8a0', face: 'proud', desc: 'pökhendi webes kutató' },
];

export interface UsageStats {
  calls: Array<{ inTok: number; outTok: number; cached: number }>;
  tokensUsed: number;
  contextWindow: number;
  model: string;
  messagesCount: number;
}

interface Props {
  deployed: DeployedAgent[];
  streams: Record<string, ChatItem[]>;
  openTabs: string[];
  activeTab: string;
  onActivate: (tabId: string) => void;
  onCloseTab: (id: string) => void;
  extraTabs: ExtraTab[];
  usage: UsageStats;
  lifetime: import('../ipc.d').LifetimeStats | null;
}

function personaAvatar(
  color: string,
  face: string,
  size = 24,
  animate = true,
  opts?: { glasses?: boolean; sweat?: boolean },
): React.ReactNode {
  const cfg: AvatarCfg = {
    shape: 'circle',
    face: (face as AvatarCfg['face']) ?? 'neutral',
    color,
  };
  return (
    <Avatar
      cfg={cfg}
      size={size}
      animate={animate}
      glasses={opts?.glasses}
      sweat={opts?.sweat}
    />
  );
}

const RESEARCHERS = new Set(['explorer', 'planner', 'reviewer']);
const CODERS = new Set(['worker', 'tester']);

/** Activity state from the agent's live stream. */
function agentLook(
  agent: DeployedAgent,
  stream: ChatItem[],
): { glasses: boolean; sweat: boolean } {
  const isResearch = RESEARCHERS.has(agent.personaId);
  const isCoder = CODERS.has(agent.personaId);

  if (agent.status !== 'running') {
    // finished researchers keep their glasses; coders cool down
    return { glasses: isResearch, sweat: false };
  }

  if (isCoder) return { glasses: false, sweat: true };
  if (isResearch) {
    // while actively running a tool they lean in — glasses stay on regardless
    return { glasses: true, sweat: false };
  }
  return { glasses: false, sweat: false };
}

export function AgentPanel(props: Props) {
  const running = props.deployed.filter((a) => a.status === 'running');
  const finished = props.deployed.filter((a) => a.status !== 'running');

  return (
    <aside className="right-panel">
      {/* tab strip */}
      <div className="rp-tabs">
        {props.deployed.length > 0 && (
          <button
            className={`rp-tab${props.activeTab === 'list' ? ' on' : ''}`}
            onClick={() => props.onActivate('list')}
          >
            Agentek
          </button>
        )}
        {props.extraTabs.map((t) => (
          <button
            key={t.id}
            className={`rp-tab${props.activeTab === t.id ? ' on' : ''}`}
            onClick={() => props.onActivate(t.id)}
          >
            {t.title}
            <span
              className="rt-close"
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                props.onCloseTab(t.id);
              }}
            >
              ×
            </span>
          </button>
        ))}
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
        {props.activeTab === 'usage' ? (
          <UsagePage usage={props.usage} lifetime={props.lifetime} />
        ) : props.activeTab.startsWith('file:') ? (
          (() => {
            const tab = props.extraTabs.find((t) => t.id === props.activeTab);
            if (!tab) return <div className="rp-empty">A tab már zárva.</div>;
            return (
              <div className="rp-fileview">
                <div className="rp-filetitle">{tab.title}</div>
                <pre className="rp-filecontent">{tab.content}</pre>
              </div>
            );
          })()
        ) : props.activeTab === 'list' || props.deployed.length === 0 ? (
          <>
            <SectionTitle>Futó / deployolt</SectionTitle>
            {running.length === 0 && finished.length === 0 && (
              <div className="rp-empty">Még nincs deployolt agent.</div>
            )}
            {[...running, ...finished].map((a) => (
              <AgentRow
                key={a.id}
                agent={a}
                stream={props.streams[a.id] ?? []}
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
                  {(() => {
                    const look = agentLook(agent, props.streams[agent.id] ?? []);
                    return personaAvatar(agent.color, agent.face, 34, true, look);
                  })()}
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

/* ── usage page ── */

function UsagePage({
  usage,
  lifetime,
}: {
  usage: UsageStats;
  lifetime?: import('../ipc.d').LifetimeStats | null;
}) {
  const inTok = usage.calls.reduce((s, c) => s + c.inTok, 0);
  const outTok = usage.calls.reduce((s, c) => s + c.outTok, 0);
  const cached = usage.calls.reduce((s, c) => s + c.cached, 0);
  const cost = estimateCost(usage.model, inTok, outTok);
  const pct = Math.min(
    100,
    Math.round((usage.tokensUsed / Math.max(1, usage.contextWindow)) * 100),
  );
  const R = 34;
  const C = 2 * Math.PI * R;
  const col = pct < 55 ? '#6fbf8f' : pct < 80 ? '#d78f3f' : '#e25b43';
  const maxBar = Math.max(1, ...usage.calls.map((c) => c.inTok + c.outTok));

  return (
    <div className="usage">
      <div className="u-hero">
        <svg viewBox="0 0 80 80" width="84" height="84">
          <circle cx="40" cy="40" r={R} fill="none" stroke="var(--line-soft)" strokeWidth="7" />
          <circle
            cx="40"
            cy="40"
            r={R}
            fill="none"
            stroke={col}
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={`${(C * pct) / 100} ${C}`}
            transform="rotate(-90 40 40)"
          />
        </svg>
        <div className="u-pct">{pct}%</div>
      </div>

      <div className="u-grid">
        <StatCard label="Token be" value={inTok.toLocaleString('hu-HU')} />
        <StatCard label="Token ki" value={outTok.toLocaleString('hu-HU')} />
        <StatCard label="Cache" value={cached ? cached.toLocaleString('hu-HU') : '—'} />
        <StatCard
          label="Költség (becslés)"
          value={cost === null ? '—' : `$${cost.toFixed(4)}`}
        />
        <StatCard label="Üzenetek" value={String(usage.messagesCount)} />
        <StatCard label="Hívások" value={String(usage.calls.length)} />
      </div>

      {lifetime && Object.keys(lifetime.models).length > 0 && (
        <>
          <SectionTitle>Összesen (minden session)</SectionTitle>
          <div className="u-grid">
            {(() => {
              let ti = 0, to = 0, ca = 0, cl = 0, cost = 0, known = true;
              for (const [m, u] of Object.entries(lifetime.models)) {
                ti += u.inTok; to += u.outTok; ca += u.cachedTok; cl += u.calls;
                const c = estimateCost(m, u.inTok, u.outTok);
                if (c === null) known = false; else cost += c;
              }
              return (
                <>
                  <StatCard label="Token össz." value={(ti + to).toLocaleString('hu-HU')} />
                  <StatCard label="Cache" value={ca ? ca.toLocaleString('hu-HU') : '—'} />
                  <StatCard label="Költség" value={known ? `$${cost.toFixed(2)}` : '$?'} />
                  <StatCard label="Hívások" value={String(cl)} />
                </>
              );
            })()}
          </div>
        </>
      )}

      <SectionTitle>Hívások token-felhasználása</SectionTitle>
      {usage.calls.length === 0 ? (
        <div className="rp-empty">Még nincs hívás ebben a sessionben.</div>
      ) : (
        <div className="u-bars">
          {usage.calls.map((c, i) => {
            const h = Math.round(((c.inTok + c.outTok) / maxBar) * 100);
            return (
              <div
                key={i}
                className="u-bar"
                style={{ height: `${Math.max(6, h)}%` }}
                title={`#${i + 1}: be ${c.inTok} · ki ${c.outTok}`}
              />
            );
          })}
        </div>
      )}

      {usage.model && <div className="t-dim" style={{ marginTop: 10 }}>modell: {usage.model}</div>}
      <div className="t-dim">context: {usage.tokensUsed.toLocaleString('hu-HU')} / {usage.contextWindow.toLocaleString('hu-HU')} token</div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="u-stat">
      <span className="u-label">{label}</span>
      <span className="u-value">{value}</span>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="rp-sec">{children}</div>;
}

function AgentRow({
  agent,
  stream,
  onOpen,
  active,
}: {
  agent: DeployedAgent;
  stream: ChatItem[];
  onOpen: () => void;
  active: boolean;
}) {
  const look = agentLook(agent, stream);
  return (
    <button className={`ag-row${active ? ' on' : ''}`} onClick={onOpen} title={agent.task}>
      <span className="ag-ava">
        {personaAvatar(agent.color, agent.face, 26, true, look)}
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
