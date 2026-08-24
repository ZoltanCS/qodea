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
import { createSpawnAgentTool } from '../agents/spawn.js';
import type { AgentDef } from '../agents/personas.js';
import { BUILTIN_AGENTS } from '../agents/personas.js';
import { isAbortError, runAgentRef } from './ref.js';

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
  | ({ type: 'usage'; inputTokens?: number; outputTokens?: number; cachedTokens?: number } & EvTag)
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
  enableSubagents?: boolean;
  maxParallelSpawns?: number;
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
  const tools = opts.tools ?? createDefaultTools();
  const specs = tools.map(toSpec);
  const toolByName = new Map(tools.map((t) => [t.name, t]));
  const state = emptyAgentState();

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

  const messages: TurnMessage[] = [
    {
      role: 'system',
      content:
        (opts.systemPrompt ??
          buildSystemPrompt({ cwd: opts.cwd, tools: specs })) +
        (opts.systemSuffix ?? ''),
    },
    ...(opts.initialMessages ?? []),
    userMessage(opts.task),
  ];

  let lastUsage: Usage | undefined;
  const finish = (
    reason: AgentRunResult['reason'],
    turns: number,
  ): AgentRunResult => ({ reason, turns, state, messages });

  for (let turn = 1; turn <= maxTurns; turn++) {
    drainInjects();
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
          lastUsage = { inputTokens: ev.inputTokens, outputTokens: ev.outputTokens };
          yield { type: 'usage', inputTokens: ev.inputTokens, outputTokens: ev.outputTokens };
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
      if (lastUsage) yield { type: 'usage', ...lastUsage };
      yield { type: 'done', reason: 'complete', turns: turn };
      return finish('complete', turn);
    }

    messages.push({ role: 'assistant', content: text, toolCalls: calls });

    // spawn_agent calls run in parallel; everything else stays sequential
    const spawns = calls.filter((c) => c.name === 'spawn_agent');
    const others = calls.filter((c) => c.name !== 'spawn_agent');

    try {
      for (const call of others) {
        if (opts.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        const gen = withBus(executeToolCall(call, toolByName, perms, state, opts), bus, () =>
          drainInjects(),
        );
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
          drainInjects();
        }
        for (const ev of bus.splice(0)) yield ev;

        // collect results in original order
        for (const { id, p } of outcomes) {
          try {
            const outcome = await p;
            yield* outcome.events;
            messages.push(outcome.message);
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
  } catch (err) {
    return fail(
      `Invalid JSON arguments: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const summary = describeSafe(tool, args);
  const verdict = await perms.authorize(tool, args);
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
