import { useCallback, useEffect, useRef, useState } from 'react';
import type { BotColor, BotMood } from '../mascot/QodeaBot';
import type { ProviderInfo, StartRequest, WireEvent } from '../ipc.d';
import type { PermissionMode, TurnMessage } from '@qodea/core';

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
  requestId?: string;
  resolved?: boolean;
}

let idCounter = 0;
const nextId = () => `i${++idCounter}`;

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
  const [flash, setFlash] = useState<BotMood | null>(null);
  const [tokensUsed, setTokensUsed] = useState(0);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [providerId, setProviderId] = useState<string>('');
  const [model, setModel] = useState<string>('');
  const [mode, setMode] = useState<PermissionMode>('default');
  const [effort, setEffort] = useState<'low' | 'medium' | 'high'>('medium');
  const [cwd, setCwd] = useState<string>('');
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const itemsRef = useRef<ChatItem[]>([]);
  itemsRef.current = items;

  useEffect(() => {
    void window.qodea.listProviders().then((res) => {
      setProviders(res.providers);
      if (res.defaultProvider) setProviderId(res.defaultProvider);
      else if (res.providers[0]) setProviderId(res.providers[0].id);
    });
    setCwd('');
  }, []);

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
    const unsub = window.qodea.onEvent((_sid, ev: WireEvent) => {
      switch (ev.type) {
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
            },
          ]);
          break;
        }
        case 'tool-result': {
          patchLastToolByName(ev.name, { content: ev.content, isError: ev.isError });
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
          break;
        }
        case 'session-done': {
          setHistory(ev.messages as TurnMessage[]);
          setStatus('idle');
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
      if (!trimmed || status === 'running') return;

      setErrorBanner(null);
      setItems((prev) => [...prev, { kind: 'user', id: nextId(), text: trimmed }]);
      setStatus('running');

      try {
        const req: StartRequest = {
          task: trimmed,
          providerId: providerId || undefined,
          model: model.trim() || undefined,
          mode,
          reasoningEffort: effort,
          cwd: cwd.trim(),
          history: history.length > 0 ? history : undefined,
        };
        const res = await window.qodea.startSession(req);
        setSessionId(res.sessionId);
      } catch (err) {
        setErrorBanner(err instanceof Error ? err.message : String(err));
        setStatus('idle');
      }
    },
    [status, providerId, model, mode, effort, cwd, history],
  );

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
  };
}
