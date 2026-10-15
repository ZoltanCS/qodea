import { PermissionManager, type PermissionAsker, type PermissionMode } from '../permissions/manager.js';
import { createDefaultTools, toSpec } from '../tools/registry.js';
import { emptyAgentState, type AgentState, type Tool } from '../tools/types.js';
import type {
  Provider,
  StopReason,
  ToolCallReq,
  TurnMessage,
  Usage,
} from '../types.js';
import { userMessage } from '../types.js';
import { buildSystemPrompt } from './prompt.js';
import { estimateContextBreakdown, estimateTokens } from '../util/tokens.js';
import { createSpawnAgentTool } from '../agents/spawn.js';
import type { AgentDef } from '../agents/personas.js';
import { BUILTIN_AGENTS } from '../agents/personas.js';
import { isAbortError, runAgentRef } from './ref.js';
import { planCompaction, summaryPrompt } from './compact.js';

/** Optional tagging so subagent events can be routed in the UI. */
export interface EvTag {
  agentId?: string;
}

/** Events the agent loop emits — this is what the UI will subscribe to. */
export type AgentEvent =
  | ({ type: 'turn-start'; turn: number } & EvTag)
  | ({ type: 'text-delta'; text: string } & EvTag)
  | ({ type: 'reasoning-delta'; text: string } & EvTag)
  | ({ type: 'tool-start'; callId: string; name: string; summary: string } & EvTag)
  | ({ type: 'tool-result'; name: string; content: string; isError: boolean } & EvTag)
  | ({ type: 'permission-denied'; name: string; summary: string } & EvTag)
  | ({ type: 'usage'; inputTokens?: number; outputTokens?: number; cachedTokens?: number; breakdown?: { system: number; tools: number; history: number; outputs: number } } & EvTag)
  | ({ type: 'done'; reason: 'complete' | 'max-turns' | 'aborted' | 'failed' | 'time-limit'; turns: number } & EvTag)
  | ({ type: 'auto-restart'; attempt: number; reason: string; delayMs: number } & EvTag)
  | ({ type: 'auto-note'; text: string } & EvTag)
  | {
      type: 'subagent-start';
      agentId: string;
      name: string;
      personaId: string;
      color: string;
      face: string;
      task: string;
  images?: string[];
    }
  | {
      type: 'subagent-done';
      agentId: string;
      name: string;
      ok: boolean;
      durationMs: number;
    };

export interface AgentRunOptions {
  provider: Provider;
  model: string;
  task: string;
  images?: string[];
  cwd: string;
  mode?: PermissionMode;
  /** Host-provided permission prompter. Required in `default` mode; ignored by yolo/read-only. */
  asker?: PermissionAsker;
  systemPrompt?: string;
  /** Appended to the default system prompt (e.g. expert-mode hint). */
  systemSuffix?: string;
  tools?: Tool[];
  /** Seed transcript — pass a previous result's messages to continue a chat. */
  initialMessages?: TurnMessage[];
  maxTurns?: number;
  maxTokens?: number;
  temperature?: number;
  /** Reasoning effort for thinking models. */
  reasoningEffort?: 'low' | 'medium' | 'high';
  signal?: AbortSignal;
  /** Route tag for this run's events ('main' = untagged). */
  agentId?: string;
  /** Available sub-agent definitions — enables the spawn_agent tool at depth 0. */
  agents?: AgentDef[];
  /** Subagents are only available at depth 0 (flat hierarchy by design). */
  depth?: number;
  /** Mutable queue — user messages typed mid-run get injected at turn boundaries. */
  injectQueue?: { items: string[] };
  /** Skip re-appending the task as a user message (continuation attempts). */
  skipTaskAppend?: boolean;
  /** Context window for compaction trigger (default 131072). */
  contextWindow?: number;
  enableSubagents?: boolean;
  maxParallelSpawns?: number;
  state?: AgentState;
  onCheckpoint?: (messages: TurnMessage[], state: AgentState) => void;
}

export interface AgentRunResult {
  reason: 'complete' | 'max-turns' | 'aborted' | 'failed' | 'time-limit';
  turns: number;
  state: AgentState;
  /** Full transcript including this run — feed it back as initialMessages to continue. */
  messages: TurnMessage[];
}

const DEFAULT_MAX_TURNS = 25;

/** Public wrapper: tags events with agentId when this is a subagent run. */
export async function* runAgent(
  opts: AgentRunOptions,
): AsyncGenerator<AgentEvent, AgentRunResult, unknown> {
  const tag = opts.agentId && opts.agentId !== 'main' ? opts.agentId : undefined;
  const gen = runAgentInner(opts);
  if (!tag) {
    for (;;) {
      const n = await gen.next();
      if (n.done) return n.value;
      yield n.value;
    }
  }
  for (;;) {
    const n = await gen.next();
    if (n.done) return n.value;
    yield { ...n.value, agentId: tag } as AgentEvent;
  }
}

/** The Qodea agent loop:
 *   task → LLM stream → tool calls → execute (with permissions) → feed results back → repeat.
 * Yields AgentEvents as it goes and resolves with the full transcript when finished. */
async function* runAgentInner(
  opts: AgentRunOptions,
): AsyncGenerator<AgentEvent, AgentRunResult, unknown> {
  const mode = opts.mode ?? 'default';
  const tools = [...(opts.tools ?? createDefaultTools())];
  const specs = tools.map(toSpec);
  const toolByName = new Map(tools.map((t) => [t.name, t]));
  const state = opts.state ?? emptyAgentState();

  const perms = new PermissionManager(mode, state, opts.asker ?? denyAll);
  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS;

  // ── subagent support (top level only) ──
  const bus: AgentEvent[] = [];
  const enableSubagents = (opts.enableSubagents ?? true) && !opts.depth;
  // fallback to built-ins so spawning ALWAYS works, even if the host forgot the list
  const effectiveAgents =
    opts.agents && opts.agents.length > 0 ? opts.agents : BUILTIN_AGENTS;
  // user messages typed while the agent runs — injected at turn boundaries
  const injectQueue = opts.injectQueue;
  if (enableSubagents && effectiveAgents.length > 0) {
    const spawnTool = createSpawnAgentTool({
      provider: opts.provider,
      model: opts.model,
      cwd: opts.cwd,
      mode,
      ...(opts.asker ? { asker: opts.asker } : {}),
      parentSignal: opts.signal,
      agents: effectiveAgents,
      publish: (ev) => bus.push(ev as AgentEvent),
    });
    tools.push(spawnTool);
    toolByName.set(spawnTool.name, spawnTool);
    specs.push(toSpec(spawnTool));
  }

  // ── user message injection (typed while running) ──
  const drainInjects = () => {
    if (injectQueue && injectQueue.items.length > 0) {
      for (const text of injectQueue.items.splice(0)) {
        messages.push(userMessage(text));
      }
    }
  };

  let messages: TurnMessage[] = [
    {
      role: 'system',
      content:
        (opts.systemPrompt ?? buildSystemPrompt()) + (opts.systemSuffix ?? ''),
    },
    ...(opts.initialMessages ?? []).filter((m) => m.role !== 'system'),
    // continuation attempts carry the task inside initialMessages — re-appending
    // would duplicate the goal as a fresh user message on every restart.
    // Safety: if the carried transcript has NO user message, still append.
    ...(opts.skipTaskAppend &&
    (opts.initialMessages ?? []).some((m) => m.role === 'user')
      ? []
      : [{ role: 'user' as const, content: `[cwd: ${opts.cwd}]\n\n${opts.task}`, ...(opts.images?.length ? { images: opts.images } : {}) }]),
  ];

  let lastUsage: Usage | undefined;
  const finish = (
    reason: AgentRunResult['reason'],
    turns: number,
  ): AgentRunResult => {
    const answered = new Set(messages.filter(m => m.role === 'tool_result').map(m => m.callId));
    for (const m of [...messages]) if (m.role === 'assistant') for (const call of m.toolCalls ?? []) {
      if (!answered.has(call.id)) {
        messages.push({ role: 'tool_result', callId: call.id, name: call.name,
          content: 'Interrupted. Inspect actual state before retrying this action.', isError: true });
        answered.add(call.id);
      }
    }
    opts.onCheckpoint?.(messages, state);
    return { reason, turns, state, messages };
  };

  let lastCompactTurn = -99;
  let compactCount = 0;

  for (let turn = 1; turn <= maxTurns; turn++) {
    drainInjects();
    opts.onCheckpoint?.(messages, state);

    // ── auto-compaction at 60% context (cheap-first: clear → summarize) ──
    const ctxWindow = opts.contextWindow ?? 131_072;
    const usedEstimate = estimateTokens(
      JSON.stringify(messages) +
        JSON.stringify(specs),
    );
    const plan = planCompaction(messages, usedEstimate, {
      ctxWindow,
      turnsSinceLast: turn - lastCompactTurn,
    });
    if (plan.should) {
      clearStaleToolResults(messages, 2);
      const stillUsed = estimateTokens(
        JSON.stringify(messages),
      );
      if (stillUsed >= ctxWindow * 0.6 && compactCount < 3) {
        // LLM summary of the middle slice (last `keepTail` messages stay raw)
        let keepFrom = Math.max(1, messages.length - 8);
        while (keepFrom > 1 && messages[keepFrom]?.role === 'tool_result') keepFrom--;
        const slice = messages.slice(1, keepFrom);
        try {
          const sumGen = opts.provider.streamChat({
            model: opts.model,
            messages: [
              {
                role: 'user',
                content:
                  summaryPrompt(slice) +
                  '\n\n[Respond with the summary only.]',
              },
            ],
            ...(opts.signal ? { signal: opts.signal } : {}),
          });
          let summary = '';
          for await (const ev of sumGen) {
            if (ev.type === 'text-delta') summary += ev.text;
            if (ev.type === 'done' && ev.stopReason === 'length') summary += ' …[cutoff]';
          }
          if (summary.trim()) {
            const summaryMsg: TurnMessage = {
              role: 'user',
              content: `[COMPACTED HISTORY — summary of ${slice.length} earlier messages]\n${summary}`,
            };
            messages = [
              messages[0]!,
              summaryMsg,
              ...messages.slice(keepFrom),
            ];
            compactCount++;
            lastCompactTurn = turn;
            yield {
              type: 'auto-note',
              text: `context compacted (${Math.round(
                (usedEstimate / ctxWindow) * 100,
              )}% → ~${Math.round((stillUsed / ctxWindow) * 100)}%)`,
            };
          }
        } catch (err) {
          if (isAbortError(err)) throw err;
          // compaction is best-effort — continue without it
          yield {
            type: 'auto-note',
            text: `compaction failed: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      }
    }

    yield { type: 'turn-start', turn };

    let text = '';
    const calls: ToolCallReq[] = [];
    let stop: StopReason | undefined;

    try {
      for await (const ev of opts.provider.streamChat({
        model: opts.model,
        messages,
        tools: specs,
        ...(opts.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}),
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        ...(opts.reasoningEffort ? { reasoningEffort: opts.reasoningEffort } : {}),
        signal: opts.signal,
      })) {
        if (ev.type === 'text-delta') {
          text += ev.text;
          yield { type: 'text-delta', text: ev.text };
        } else if (ev.type === 'reasoning-delta') {
          // live thinking — surfaced to the UI, deliberately not stored in the transcript
          yield { type: 'reasoning-delta', text: ev.text };
        } else if (ev.type === 'tool-call') {
          calls.push({ id: ev.id, name: ev.name, argumentsJson: ev.argumentsJson });
        } else if (ev.type === 'usage') {
          lastUsage = { inputTokens: ev.inputTokens, outputTokens: ev.outputTokens, cachedTokens: ev.cachedTokens };
          const breakdown = estimateContextBreakdown({
            system: (messages[0]?.content as string) ?? '',
            toolsJson: JSON.stringify(specs),
            messages: messages.slice(1),
          });
          yield {
            type: 'usage',
            inputTokens: ev.inputTokens,
            outputTokens: ev.outputTokens,
            cachedTokens: ev.cachedTokens,
            breakdown,
          };
        } else if (ev.type === 'done') {
          stop = ev.stopReason;
        }
      }
    } catch (err) {
      if (opts.signal?.aborted || isAbortError(err)) {
        yield { type: 'done', reason: 'aborted', turns: turn };
        return finish('aborted', turn);
      }
      throw err;
    }

    if (opts.signal?.aborted) {
      yield { type: 'done', reason: 'aborted', turns: turn };
      return finish('aborted', turn);
    }

    if (calls.length === 0) {
      messages.push({ role: 'assistant', content: text });

      const reason = stop === 'length' ? 'max-turns' : stop === 'end' && text.trim() ? 'complete' : 'failed';
      yield { type: 'done', reason, turns: turn };
      return finish(reason, turn);
    }

    messages.push({ role: 'assistant', content: text, toolCalls: calls });

    // spawn_agent calls run in parallel; everything else stays sequential
    const spawns = calls.filter((c) => c.name === 'spawn_agent');
    const others = calls.filter((c) => c.name !== 'spawn_agent');

    try {
      for (const call of others) {
        if (opts.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        const gen = withBus(executeToolCall(call, toolByName, perms, state, opts), bus);
        let outcome: ToolOutcome | undefined;
        for (;;) {
          const { value, done } = await gen.next();
          if (done) {
            outcome = value as ToolOutcome;
            break;
          }
          yield value as AgentEvent;
        }
        for (const ev of outcome!.events) yield ev;
        messages.push(outcome!.message);
        opts.onCheckpoint?.(messages, state);
      }

      if (spawns.length > 0) {
        const maxParallel = opts.maxParallelSpawns ?? 3;

        // overflow calls fail fast without starting
        for (const call of spawns.slice(maxParallel)) {
          const content = `Spawn limit reached (${maxParallel} parallel). Run the rest in a later turn.`;
          yield { type: 'tool-result', name: call.name, content, isError: true };
          messages.push({
            role: 'tool_result',
            callId: call.id,
            name: call.name,
            content,
            isError: true,
          });
        }

        const pending = new Set<Promise<ToolOutcome>>();
        const outcomes: Array<{ id: string; p: Promise<ToolOutcome> }> = [];
        for (const call of spawns.slice(0, maxParallel)) {
          if (opts.signal?.aborted) break;
          const p = executeToolCall(call, toolByName, perms, state, opts);
          outcomes.push({ id: call.id, p });
          void p.finally(() => pending.delete(p)).catch(() => {});
          pending.add(p);
        }

        // stream child events live until every spawned agent settles
        while (pending.size > 0) {
          await Promise.race([Promise.allSettled([...pending]), sleep(60)]);
          for (const ev of bus.splice(0)) yield ev;
        }
        for (const ev of bus.splice(0)) yield ev;

        // collect results in original order
        for (const { id, p } of outcomes) {
          try {
            const outcome = await p;
            yield* outcome.events;
            messages.push(outcome.message);
            opts.onCheckpoint?.(messages, state);
          } catch (err) {
            const call = spawns.find((c) => c.id === id)!;
            const content = isAbortError(err)
              ? 'aborted'
              : `spawn failed: ${err instanceof Error ? err.message : String(err)}`;
            messages.push({
              role: 'tool_result',
              callId: id,
              name: call.name,
              content,
              isError: true,
            });
            yield { type: 'tool-result', name: call.name, content, isError: true };
          }
        }
      }
    } catch (err) {
      if (opts.signal?.aborted || isAbortError(err)) {
        yield { type: 'done', reason: 'aborted', turns: turn };
        return finish('aborted', turn);
      }
      throw err;
    }

    if (opts.signal?.aborted) {
      yield { type: 'done', reason: 'aborted', turns: turn };
      return finish('aborted', turn);
    }

    // ── stale tool-result clearing: old outputs cost tokens every turn ──
    clearStaleToolResults(messages, 6);

    if (stop === 'length') {
      // context exhausted mid-action — surface instead of looping into a wall
      yield { type: 'done', reason: 'max-turns', turns: turn };
      return finish('max-turns', turn);
    }
  }

  yield { type: 'done', reason: 'max-turns', turns: maxTurns };
  return finish('max-turns', maxTurns);
}

interface ToolOutcome {
  message: TurnMessage;
  events: AgentEvent[];
}

async function executeToolCall(
  call: ToolCallReq,
  toolByName: Map<string, Tool>,
  perms: PermissionManager,
  state: AgentState,
  opts: AgentRunOptions,
): Promise<ToolOutcome> {
  const fail = (content: string): ToolOutcome => ({
    message: { role: 'tool_result', callId: call.id, name: call.name, content, isError: true },
    events: [{ type: 'tool-result', name: call.name, content, isError: true }],
  });

  const tool = toolByName.get(call.name);
  if (!tool) {
    return fail(
      `Unknown tool "${call.name}". Available: ${[...toolByName.keys()].join(', ')}`,
    );
  }

  let args: Record<string, unknown>;
  try {
    args = JSON.parse(call.argumentsJson || '{}');
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Expected a JSON object');
    const required = tool.parametersJsonSchema['required'] as string[] | undefined;
    for (const key of required ?? []) if (!(key in args)) throw new Error(`Missing required argument: ${key}`);
    const properties = tool.parametersJsonSchema['properties'] as Record<string, { type?: string; enum?: unknown[] }> | undefined;
    for (const [key, value] of Object.entries(args)) {
      const schema = properties?.[key];
      if (!schema) continue;
      const actual = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
      if (schema.type && actual !== schema.type && !(schema.type === 'integer' && typeof value === 'number' && Number.isInteger(value)))
        throw new Error(`${key} must be ${schema.type}, got ${actual}`);
      if (schema.enum && !schema.enum.includes(value)) throw new Error(`${key} must be one of: ${schema.enum.join(', ')}`);
    }
  } catch (err) {
    return fail(
      `Invalid JSON arguments: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const summary = describeSafe(tool, args);
  let verdict;
  try { verdict = await perms.authorize(tool, args); }
  catch (err) { return fail(`Permission check failed: ${err instanceof Error ? err.message : String(err)}`); }
  if (!verdict.allowed) {
    return {
      message: {
        role: 'tool_result',
        callId: call.id,
        name: call.name,
        content: `Permission denied: ${verdict.reason}`,
        isError: true,
      },
      events: [
        { type: 'permission-denied', name: call.name, summary },
        { type: 'tool-result', name: call.name, content: verdict.reason ?? 'denied', isError: true },
      ],
    };
  }

  const startedEvents: AgentEvent[] = [
    { type: 'tool-start', callId: call.id, name: call.name, summary },
  ];

  try {
    const content = await tool.run(args, { cwd: opts.cwd, state, signal: opts.signal });
    return {
      message: { role: 'tool_result', callId: call.id, name: call.name, content },
      events: [...startedEvents, { type: 'tool-result', name: call.name, content, isError: false }],
    };
  } catch (err) {
    if (opts.signal?.aborted || isAbortError(err)) throw err;
    const content = err instanceof Error ? err.message : String(err);
    return {
      message: { role: 'tool_result', callId: call.id, name: call.name, content, isError: true },
      events: [...startedEvents, { type: 'tool-result', name: call.name, content, isError: true }],
    };
  }
}

function describeSafe(tool: Tool, args: Record<string, unknown>): string {
  try {
    return tool.describe(args);
  } catch {
    return tool.name;
  }
}

const denyAll: PermissionAsker = async () => false;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Wraps a tool promise: yields bus events live while it runs, returns its result. */
async function* withBus<T>(
  p: Promise<T>,
  bus: AgentEvent[],
  onPoll?: () => void,
): AsyncGenerator<AgentEvent, T, unknown> {
  let settled = false;
  let result: T = undefined as T;
  let thrown: unknown;

  const tracked = p.then(
    (v) => {
      settled = true;
      result = v;
    },
    (e) => {
      settled = true;
      thrown = e;
    },
  );

  while (!settled) {
    await Promise.race([tracked, sleep(50)]);
    for (const ev of bus.splice(0)) yield ev;
    onPoll?.();
  }
  for (const ev of bus.splice(0)) yield ev;
  if (thrown !== undefined) throw thrown;
  return result;
}

// register the runtime reference so spawn.ts can launch child runs
runAgentRef.current = runAgent;

/**
 * Token diet: tool results older than the last `keepLast` tool interactions
 * get their output replaced with a stub (the call itself stays for history).
 * Re-running the tool regenerates the output — near-lossless compaction.
 */
function clearStaleToolResults(messages: TurnMessage[], keepLast: number): void {
  const toolIdx: number[] = [];
  messages.forEach((m, i) => {
    if (m.role === 'tool_result') toolIdx.push(i);
  });
  const stale = toolIdx.slice(0, Math.max(0, toolIdx.length - keepLast));
  for (const i of stale) {
    const m = messages[i]!;
    if (m.role === 'tool_result' && m.content.length > 200) {
      messages[i] = {
        ...m,
        content: `[output cleared — ${m.name} is re-runnable if needed]`,
      };
    }
  }
}
