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

/** Events the agent loop emits — this is what the UI will subscribe to. */
export type AgentEvent =
  | { type: 'turn-start'; turn: number }
  | { type: 'text-delta'; text: string }
  | { type: 'tool-start'; callId: string; name: string; summary: string }
  | { type: 'tool-result'; name: string; content: string; isError: boolean }
  | { type: 'permission-denied'; name: string; summary: string }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number }
  | { type: 'done'; reason: 'complete' | 'max-turns' | 'aborted'; turns: number };

export interface AgentRunOptions {
  provider: Provider;
  model: string;
  task: string;
  cwd: string;
  mode?: PermissionMode;
  /** Host-provided permission prompter. Required in `default` mode; ignored by yolo/read-only. */
  asker?: PermissionAsker;
  systemPrompt?: string;
  tools?: Tool[];
  /** Seed transcript — pass a previous result's messages to continue a chat. */
  initialMessages?: TurnMessage[];
  maxTurns?: number;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface AgentRunResult {
  reason: 'complete' | 'max-turns' | 'aborted';
  turns: number;
  state: AgentState;
  /** Full transcript including this run — feed it back as initialMessages to continue. */
  messages: TurnMessage[];
}

const DEFAULT_MAX_TURNS = 25;

/** The Qodea agent loop:
 *   task → LLM stream → tool calls → execute (with permissions) → feed results back → repeat.
 * Yields AgentEvents as it goes and resolves with the full transcript when finished. */
export async function* runAgent(
  opts: AgentRunOptions,
): AsyncGenerator<AgentEvent, AgentRunResult, unknown> {
  const mode = opts.mode ?? 'default';
  const tools = opts.tools ?? createDefaultTools();
  const specs = tools.map(toSpec);
  const toolByName = new Map(tools.map((t) => [t.name, t]));
  const state = emptyAgentState();

  const perms = new PermissionManager(mode, state, opts.asker ?? denyAll);
  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS;

  const messages: TurnMessage[] = [
    {
      role: 'system',
      content:
        opts.systemPrompt ??
        buildSystemPrompt({ cwd: opts.cwd, tools: specs }),
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
    yield { type: 'turn-start', turn };

    let text = '';
    const calls: ToolCallReq[] = [];
    let stop: StopReason | undefined;

    for await (const ev of opts.provider.streamChat({
      model: opts.model,
      messages,
      tools: specs,
      ...(opts.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}),
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      signal: opts.signal,
    })) {
      if (ev.type === 'text-delta') {
        text += ev.text;
        yield { type: 'text-delta', text: ev.text };
      } else if (ev.type === 'tool-call') {
        calls.push({ id: ev.id, name: ev.name, argumentsJson: ev.argumentsJson });
      } else if (ev.type === 'usage') {
        lastUsage = { inputTokens: ev.inputTokens, outputTokens: ev.outputTokens };
        yield { type: 'usage', inputTokens: ev.inputTokens, outputTokens: ev.outputTokens };
      } else if (ev.type === 'done') {
        stop = ev.stopReason;
      }
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

    for (const call of calls) {
      const outcome = await executeToolCall(call, toolByName, perms, state, opts);
      for (const event of outcome.events) yield event;
      messages.push(outcome.message);
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
