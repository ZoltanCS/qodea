import { useCallback, useEffect, useRef, useState } from 'react';
import type { BotColor, BotMood } from '../mascot/QodeaBot';
import type {
  ProviderInfo,
  StartRequest,
  WireEvent,
  SessionSummary,
  StoredSession,
  ProjectInfo,
} from '../ipc.d';
import type { PermissionMode, TurnMessage } from '@qodea/core';
import { loadPrefs, savePrefs } from './prefs';

const initialPrefs = loadPrefs();

export interface ChatItem {
  id: string;
  kind: 'user' | 'assistant' | 'tool' | 'permission';
  text?: string;
  /** live reasoning ("thinking") stream — shown dimmed, not part of the answer */
  reasoning?: string;
  /** tool result output */
  content?: string;
  name?: string;
  summary?: string;
  isError?: boolean;
  running?: boolean;
  queued?: boolean;
  startedAt?: number;
  durationMs?: number;
  requestId?: string;
  resolved?: boolean;
}

let idCounter = 0;
const nextId = () => `i${++idCounter}`;

export interface ExtraTab {
  id: string;
  title: string;
  kind: 'usage' | 'file';
  content?: string;
}

export interface DeployedAgent {
  id: string;
  name: string;
  personaId: string;
  color: string;
  face: string;
  task: string;
  status: 'running' | 'done' | 'error';
  startedAt: number;
}

export const MODES: Array<{ value: PermissionMode; label: string; hint: string }> = [
  { value: 'read-only', label: 'Read', hint: 'csak olvashat és tervezhet' },
  { value: 'default', label: 'Ask', hint: 'írás előtt kérdez' },
  { value: 'yolo', label: 'YOLO', hint: 'full-auto, nem kérdez' },
];

export const EFFORTS: Array<{ value: 'low' | 'medium' | 'high'; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Med' },
  { value: 'high', label: 'High' },
];

export function useChatSession() {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [status, setStatus] = useState<'idle' | 'running'>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [history, setHistory] = useState<TurnMessage[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [uiMode, setUiModeState] = useState<'agent' | 'experts'>(initialPrefs.uiMode ?? 'agent');

  // ── usage stats (per LLM call) ──
  const [usageCalls, setUsageCalls] = useState<Array<{ inTok: number; outTok: number; cached: number }>>([]);

  // ── multi-agent state ──
  const [deployedAgents, setDeployedAgents] = useState<DeployedAgent[]>([]);
  const [agentStreams, setAgentStreams] = useState<Record<string, ChatItem[]>>({});
  const [openAgentTabs, setOpenAgentTabs] = useState<string[]>([]);
  const [activeAgentTab, setActiveAgentTab] = useState<string>('list');
  const [panelOpen, setPanelOpen] = useState(false);

  // ── whiteboard tabs (usage / file preview / …) ──
  const [extraTabs, setExtraTabs] = useState<Array<{ id: string; title: string; kind: 'usage' | 'file'; content?: string }>>([]);

  // ── multi-agent: deployed subagents + their live streams ──
  const [flash, setFlash] = useState<BotMood | null>(null);
  const [tokensUsed, setTokensUsed] = useState(0);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [providerId, setProviderId] = useState<string>('');
  const [model, setModel] = useState<string>('');
  const [mode, setModeState] = useState<PermissionMode>(initialPrefs.mode ?? 'default');
  const [effort, setEffortState] = useState<'low' | 'medium' | 'high'>(
    initialPrefs.effort ?? 'medium',
  );

  // persist agent prefs on change
  useEffect(() => {
    savePrefs({ mode, effort, uiMode });
  }, [mode, effort, uiMode]);

  const setMode = setModeState;
  const setEffort = setEffortState;
  const setUiMode = setUiModeState;

  // live-sync when prefs change from the Settings modal
  useEffect(() => {
    const handler = () => {
      const p = loadPrefs();
      if (p.mode) setModeState(p.mode);
      if (p.effort) setEffortState(p.effort);
      if (p.uiMode) setUiModeState(p.uiMode);
    };
    window.addEventListener('qodea-prefs-changed', handler);
    return () => window.removeEventListener('qodea-prefs-changed', handler);
  }, []);
  const [cwd, setCwd] = useState<string>('');
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const itemsRef = useRef<ChatItem[]>([]);
  itemsRef.current = items;

  const reloadSessions = useCallback(async () => {
    setSessions(await window.qodea.sessionsList());
    setProjects(await window.qodea.projectsList());
  }, []);

  const addProject = useCallback(async () => {
    const created = await window.qodea.projectAdd();
    if (created) {
      await reloadSessions();
      setCwd(created.cwd);
    }
    return created;
  }, [reloadSessions]);

  useEffect(() => {
    void reloadSessions();
    void window.qodea.listProviders().then((res) => {
      setProviders(res.providers);
      if (res.defaultProvider) setProviderId(res.defaultProvider);
      else if (res.providers[0]) setProviderId(res.providers[0].id);
    });
    setCwd('');
  }, []);

  const reloadProviders = useCallback(async () => {
    const res = await window.qodea.listProviders();
    setProviders(res.providers);
    if (res.providers.length > 0 && !res.providers.some((p) => p.id === providerId)) {
      if (res.defaultProvider) setProviderId(res.defaultProvider);
      else setProviderId(res.providers[0]!.id);
      const sel = res.providers.find((p) => p.id === (res.defaultProvider ?? res.providers[0]!.id));
      setModel(sel?.defaultModel ?? '');
    }
  }, [providerId]);

  const hideProject = useCallback(async (id: string) => {
    await window.qodea.projectHide(id, true);
    await reloadSessions();
  }, [reloadSessions]);

  const patchLastToolByName = useCallback((name: string, patch: Partial<ChatItem>) => {
    setItems((prev) => {
      for (let i = prev.length - 1; i >= 0; i--) {
        const item = prev[i];
        if (item && item.kind === 'tool' && item.name === name && item.running) {
          const copy = [...prev];
          copy[i] = { ...item, ...patch, running: false };
          return copy;
        }
      }
      return prev;
    });
  }, []);

  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashMood = useCallback((mood: BotMood, ms = 1600) => {
    setFlash(mood);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), ms);
  }, []);

  useEffect(() => {
    const unsub = window.qodea.onEvent((sid, ev: WireEvent) => {
      // ── 0) adopt runs started elsewhere (e.g. brainstorm materialize) ──
      if (sid && sid !== activeSessionId && status === 'idle') {
        setSessionId(sid);
        setActiveSessionId(sid);
        setStatus('running');
      }
      // ── 1) subagent lifecycle: update deployed list (they carry ag_ ids too) ──
      if (ev.type === 'subagent-start') {
        setDeployedAgents((prev) =>
          prev.some((a) => a.id === ev.agentId)
            ? prev
            : [
                ...prev,
                {
                  id: ev.agentId,
                  name: ev.name,
                  personaId: ev.personaId,
                  color: ev.color,
                  face: ev.face,
                  task: ev.task,
                  status: 'running' as const,
                  startedAt: Date.now(),
                },
              ],
        );
        setPanelOpen(true);
        return;
      }
      if (ev.type === 'subagent-done') {
        setDeployedAgents((prev) =>
          prev.map((a) =>
            a.id === ev.agentId
              ? { ...a, status: ev.ok ? ('done' as const) : ('error' as const) }
              : a,
          ),
        );
        return;
      }

      // ── 2) subagent stream events → route into that agent's own buffer ──
      const agentId = (ev as { agentId?: string }).agentId;
      if (agentId && agentId.startsWith('ag_')) {
        switch (ev.type) {
          case 'text-delta':
          case 'reasoning-delta': {
            const text = ev.text;
            const isReasoning = ev.type === 'reasoning-delta';
            setAgentStreams((prev) => {
              const arr = prev[agentId] ?? [];
              const last = arr[arr.length - 1];
              if (last?.kind === 'assistant') {
                const copyArr = arr.slice(0, -1);
                if (isReasoning) {
                  copyArr.push({ ...last, reasoning: (last.reasoning ?? '') + text });
                } else {
                  copyArr.push({ ...last, text: (last.text ?? '') + text });
                }
                return { ...prev, [agentId]: copyArr };
              }
              const fresh: ChatItem = isReasoning
                ? { kind: 'assistant', id: nextId(), reasoning: text }
                : { kind: 'assistant', id: nextId(), text };
              return { ...prev, [agentId]: [...arr, fresh] };
            });
            break;
          }
          case 'tool-start': {
            setAgentStreams((prev) => ({
              ...prev,
              [agentId]: [
                ...(prev[agentId] ?? []),
                {
                  kind: 'tool',
                  id: nextId(),
                  name: ev.name,
                  summary: ev.summary,
                  running: true,
                  startedAt: Date.now(),
                },
              ],
            }));
            break;
          }
          case 'tool-result': {
            setAgentStreams((prev) => {
              const arr = [...(prev[agentId] ?? [])];
              for (let i = arr.length - 1; i >= 0; i--) {
                const it = arr[i];
                if (it?.kind === 'tool' && it.name === ev.name && it.running) {
                  arr[i] = {
                    ...it,
                    content: ev.content,
                    isError: ev.isError,
                    running: false,
                    durationMs: it.startedAt ? Date.now() - it.startedAt : undefined,
                  };
                  return { ...prev, [agentId]: arr };
                }
              }
              return prev;
            });
            break;
          }
          default:
            break;
        }
        return;
      }

      // ── 3) main agent events ──
      switch (ev.type) {
        case 'turn-start': {
          // queued messages have been injected into the transcript
          setItems((prev) => prev.map((it) => (it.queued ? { ...it, queued: false } : it)));
          break;
        }
        case 'reasoning-delta': {
          setItems((prev) => {
            const last = prev[prev.length - 1];
            // attach to the current assistant turn while it has no visible text yet
            if (last?.kind === 'assistant' && !last.text) {
              const copy = [...prev.slice(0, -1)];
              copy.push({ ...last, reasoning: (last.reasoning ?? '') + ev.text });
              return copy;
            }
            return [...prev, { kind: 'assistant', id: nextId(), reasoning: ev.text }];
          });
          break;
        }
        case 'text-delta': {
          setItems((prev) => {
            const last = prev[prev.length - 1];
            if (last?.kind === 'assistant') {
              const copy = [...prev.slice(0, -1)];
              copy.push({ ...last, text: (last.text ?? '') + ev.text });
              return copy;
            }
            return [...prev, { kind: 'assistant', id: nextId(), text: ev.text }];
          });
          break;
        }
        case 'tool-start': {
          setItems((prev) => [
            ...prev,
            {
              kind: 'tool',
              id: nextId(),
              name: ev.name,
              summary: ev.summary,
              running: true,
              startedAt: Date.now(),
            },
          ]);
          break;
        }
        case 'tool-result': {
          setItems((prev) => {
            for (let i = prev.length - 1; i >= 0; i--) {
              const item = prev[i];
              if (item && item.kind === 'tool' && item.name === ev.name && item.running) {
                const copy = [...prev];
                copy[i] = {
                  ...item,
                  content: ev.content,
                  isError: ev.isError,
                  running: false,
                  durationMs: item.startedAt ? Date.now() - item.startedAt : undefined,
                };
                return copy;
              }
            }
            return prev;
          });
          if (ev.isError) flashMood('error');
          break;
        }
        case 'permission-request': {
          setItems((prev) => [
            ...prev,
            {
              kind: 'permission',
              id: nextId(),
              requestId: ev.requestId,
              name: ev.tool,
              summary: ev.summary,
              resolved: false,
            },
          ]);
          break;
        }
        case 'usage': {
          setTokensUsed((ev.inputTokens ?? 0) + (ev.outputTokens ?? 0));
          setUsageCalls((prev) => [
            ...prev,
            {
              inTok: ev.inputTokens ?? 0,
              outTok: ev.outputTokens ?? 0,
              cached: ev.cachedTokens ?? 0,
            },
          ]);
          break;
        }
        case 'auto-restart': {
          setItems((prev) => [
            ...prev,
            {
              kind: 'assistant',
              id: nextId(),
              text: `[AUTO] #${ev.attempt} újraindítás — ${ev.reason}. Folytatás ${Math.round(ev.delayMs / 1000)}s múlva.`,
            },
          ]);
          break;
        }
        case 'auto-note': {
          setItems((prev) => {
            const last = prev[prev.length - 1];
            if (last?.kind === 'assistant' && last.text?.startsWith('[AUTO]')) return prev;
            return [...prev, { kind: 'assistant', id: nextId(), text: `[AUTO] ${ev.text}` }];
          });
          break;
        }
        case 'session-done': {
          setHistory(ev.messages as TurnMessage[]);
          setStatus('idle');
          void reloadSessions();
          setDeployedAgents((prev) =>
            prev.map((a) => (a.status === 'running' ? { ...a, status: 'done' as const } : a)),
          );
          flashMood(ev.reason === 'complete' ? 'success' : 'error', 2600);
          break;
        }
        case 'session-error': {
          setErrorBanner(ev.message);
          setStatus('idle');
          flashMood('error', 2600);
          break;
        }
        default:
          break;
      }
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patchLastToolByName]);

  const send = useCallback(
    async (task: string) => {
      const trimmed = task.trim();
      if (!trimmed) return;

      // ── agent already running → queue the message for the next turn ──
      if (status === 'running') {
        if (!sessionId) {
          setErrorBanner('No active session — message not queued.');
          return;
        }
        const queuedId = nextId();
        setItems((prev) => [
          ...prev,
          { kind: 'user', id: queuedId, text: trimmed, queued: true },
        ]);
        try {
          const qr = await window.qodea.sendMessage(sessionId, trimmed);
          if (!qr.queued) {
            setItems((prev) => prev.filter((it) => it.id !== queuedId));
            setErrorBanner('Running session unreachable — message not queued.');
          }
        } catch (err) {
          setItems((prev) => prev.filter((it) => it.id !== queuedId));
          setErrorBanner(err instanceof Error ? err.message : String(err));
        }
        return;
      }

      setErrorBanner(null);
      setItems((prev) => [...prev, { kind: 'user', id: nextId(), text: trimmed }]);
      setStatus('running');

      try {
        const req: StartRequest = {
          task: trimmed,
          ...(activeSessionId ? { sessionId: activeSessionId } : {}),
          providerId: providerId || undefined,
          model: model.trim() || undefined,
          mode,
          reasoningEffort: effort,
          uiMode,
          cwd: cwd.trim(),
          history: history.length > 0 ? history : undefined,
        };
        const res = await window.qodea.startSession(req);
        setSessionId(res.sessionId);
        setActiveSessionId(res.sessionId);
      } catch (err) {
        setErrorBanner(err instanceof Error ? err.message : String(err));
        setStatus('idle');
      }
    },
    [status, providerId, model, mode, effort, uiMode, cwd, history, activeSessionId],
  );

  /** Opens a stored session back into the view and continues it. */
  const openSession = useCallback(async (id: string) => {
    if (status === 'running') return;
    const full: StoredSession | null = await window.qodea.sessionGet(id);
    if (!full) return;

    const restored: ChatItem[] = [];
    let n = 0;
    const nextIdLocal = () => `r${++n}`;

    for (const m of full.messages as unknown as TurnMessage[]) {
      if (m.role === 'system') continue;
      if (m.role === 'user') {
        restored.push({ kind: 'user', id: nextIdLocal(), text: m.content });
      } else if (m.role === 'assistant') {
        for (const tc of m.toolCalls ?? []) {
          restored.push({
            kind: 'tool',
            id: nextIdLocal(),
            name: tc.name,
            summary: tc.argumentsJson,
            content: '',
            running: false,
          });
        }
        if (m.content) {
          restored.push({ kind: 'assistant', id: nextIdLocal(), text: m.content });
        }
      } else if (m.role === 'tool_result') {
        const tool = [...restored].reverse().find(
          (it) => it.kind === 'tool' && it.name === m.name && it.content === '',
        );
        if (tool) {
          tool.content = m.content;
          tool.isError = m.isError ?? false;
        }
      }
    }

    setItems(restored);
    setHistory(full.messages as TurnMessage[]);
    setActiveSessionId(id);
    setSessionId(id);
    setStatus('idle');
    setTokensUsed(0);
    setErrorBanner(null);
  }, [status]);

  const newChat = useCallback(() => {
    if (status === 'running') return;
    setItems([]);
    setHistory([]);
    setActiveSessionId(null);
    setSessionId(null);
    setTokensUsed(0);
    setErrorBanner(null);
    setDeployedAgents([]);
    setAgentStreams({});
    setOpenAgentTabs([]);
    setActiveAgentTab('list');
    setUsageCalls([]);
  }, [status]);

  const removeSession = useCallback(async (id: string) => {
    await window.qodea.sessionDelete(id);
    await reloadSessions();
    if (id === activeSessionId) newChat();
  }, [activeSessionId, newChat, reloadSessions]);

  const stop = useCallback(async () => {
    if (sessionId) await window.qodea.stopSession(sessionId);
  }, [sessionId]);

  const respond = useCallback(
    async (requestId: string, approved: boolean) => {
      setItems((prev) =>
        prev.map((it) =>
          it.kind === 'permission' && it.requestId === requestId
            ? { ...it, resolved: true, isError: !approved }
            : it,
        ),
      );
      if (sessionId) await window.qodea.respondPermission(sessionId, requestId, approved);
    },
    [sessionId],
  );

  const selectedProvider = providers.find((p) => p.id === providerId) ?? null;

  let mood: BotMood = 'idle';
  let color: BotColor = 'cream';
  if (status === 'running') {
    const toolRunning = [...itemsRef.current]
      .reverse()
      .some((it) => it.kind === 'tool' && it.running);
    const pendingPerm = [...itemsRef.current]
      .reverse()
      .some((it) => it.kind === 'permission' && !it.resolved);
    mood = toolRunning ? 'working' : pendingPerm ? 'waiting' : 'thinking';
    color = toolRunning ? 'red' : 'cream';
  }
  if (flash === 'success') mood = 'success';
  if (flash === 'error') {
    mood = 'error';
    color = 'red';
  }

  return {
    items,
    status,
    mood,
    color,
    tokensUsed,
    contextWindow: selectedProvider?.contextWindow ?? 131072,
    usageCalls,
    messagesCount: items.filter((i) => i.kind === 'user' || i.kind === 'assistant').length,
    providers,
    selectedProvider,
    providerId,
    setProviderId,
    model,
    setModel,
    mode,
    setMode,
    effort,
    setEffort,
    cwd,
    setCwd,
    errorBanner,
    send,
    stop,
    respond,
    reloadProviders,
    sessions,
    projects,
    addProject,
    hideProject,
    activeSessionId,
    uiMode,
    setUiMode,
    openSession,
    newChat,
    removeSession,
    deployedAgents,
    agentStreams,
    openAgentTabs,
    activeAgentTab,
    setActiveAgentTab,
    panelOpen,
    setPanelOpen,
    extraTabs,
    openUsageTab: () => {
      setExtraTabs((prev) =>
        prev.some((t) => t.id === 'usage') ? prev : [...prev, { id: 'usage', title: 'Usage', kind: 'usage' as const }],
      );
      setPanelOpen(true);
      setActiveAgentTab('usage');
    },
    openFileTab: (title: string, content: string) => {
      const id = `file:${Date.now()}`;
      setExtraTabs((prev) => [...prev, { id, title, kind: 'file' as const, content }]);
      setPanelOpen(true);
      setActiveAgentTab(id);
    },
    closePanelTab: (id: string) => {
      if (id.startsWith('ag_')) {
        setOpenAgentTabs((prev) => prev.filter((t) => t !== id));
      } else {
        setExtraTabs((prev) => prev.filter((t) => t.id !== id));
      }
      setActiveAgentTab((cur) => (cur === id ? 'list' : cur));
    },
    openAgentTab: (id: string) => {
      setOpenAgentTabs((prev) => (prev.includes(id) ? prev : [...prev, id]));
      setActiveAgentTab(id);
    },
    closeAgentTab: (id: string) => {
      setOpenAgentTabs((prev) => prev.filter((t) => t !== id));
      setActiveAgentTab((cur) => (cur === id ? 'list' : cur));
    },
  };
}
