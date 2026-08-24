import { InvalidArgsError, type Tool } from '../tools/types.js';
import { createDefaultTools } from '../tools/registry.js';
import { buildSystemPrompt } from '../agent/prompt.js';
import { runAgentRef } from '../agent/ref.js';
import type { PermissionAsker, PermissionMode } from '../permissions/manager.js';
import type { Provider } from '../types.js';
import type { AgentDef } from './personas.js';

/** Events a spawned child pushes back onto the shared bus. */
type PublishFn = (ev: Record<string, unknown> & { agentId: string }) => void;

export interface SpawnDeps {
  provider: Provider;
  model: string;
  cwd: string;
  mode: PermissionMode;
  asker?: PermissionAsker;
  parentSignal?: AbortSignal;
  /** Available agent definitions (built-ins merged with user config). */
  agents: AgentDef[];
  /** Receives child events, already tagged with the child's agentId. */
  publish: PublishFn;
}

interface SpawnArgs {
  agent: string;
  task: string;
  name?: string;
}

let counter = 0;

/**
 * The `spawn_agent` tool: launches a full sub-run with the chosen agent def,
 * restricted toolset and its own context window. Flat hierarchy by design —
 * children cannot spawn further agents.
 */
export function createSpawnAgentTool(deps: SpawnDeps): Tool {
  const agentList = deps.agents.map((a) => `${a.id} (${a.name})`).join(', ');

  return {
    name: 'spawn_agent',
    description:
      'Launch a specialist sub-agent for a self-contained subtask. Agents: ' +
      agentList +
      '. Give a short display name + complete instruction (child cannot see this chat).',
    kind: 'write',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          enum: deps.agents.map((a) => a.id),
          description: 'Which specialist to launch.',
        },
        name: {
          type: 'string',
          description: 'Short display name you give this instance (e.g. "Kódbázis felderítő").',
        },
        task: {
          type: 'string',
          description: 'Complete, self-sufficient instruction for the sub-agent.',
        },
      },
      required: ['agent', 'task'],
    },

    describe(args) {
      const who = typeof args['name'] === 'string' && args['name'] ? args['name'] : String(args['agent'] ?? '?');
      const t = String(args['task'] ?? '');
      return `${who}: ${t.length > 60 ? `${t.slice(0, 60)}…` : t}`;
    },

    async run(rawArgs) {
      const args = rawArgs as unknown as SpawnArgs;
      const agentIdRaw = String(args.agent ?? '');
      const persona = deps.agents.find((a) => a.id === agentIdRaw);
      if (!persona) {
        throw new InvalidArgsError(`Unknown agent "${agentIdRaw}". Available: ${agentList}`);
      }
      const task = String(args.task ?? '').trim();
      if (!task) throw new InvalidArgsError('spawn_agent requires a "task" string');
      const taskWithCwd = `[cwd: ${deps.cwd}]\n\n${task}`;

      const agent = deps.agents.find((a) => a.id === agentIdRaw) ?? deps.agents[0];
      const displayName =
        typeof args.name === 'string' && args.name.trim()
          ? args.name.trim().slice(0, 40)
          : persona.name;

      const childId = `ag_${++counter}_${Math.random().toString(36).slice(2, 7)}`;
      const startedAt = Date.now();

      deps.publish({
        type: 'subagent-start',
        agentId: childId,
        name: displayName,
        personaId: persona.id,
        color: persona.color,
        face: persona.face,
        task,
      });

      const childTools = createDefaultTools().filter((t) =>
        (persona.tools).includes(t.name),
      );

      let finalText = '';
      let reason = 'unknown';

      const gen = runAgentRef.current({
        provider: deps.provider,
        model: deps.model,
        task: taskWithCwd,
        cwd: deps.cwd,
        mode: deps.mode,
        ...(deps.asker ? { asker: deps.asker } : {}),
        signal: deps.parentSignal,
        agentId: childId,
        depth: 1, // flat hierarchy — children never spawn
        tools: childTools,
        systemPrompt:
          buildSystemPrompt() + '\n\n' + persona.prompt,
      });

      for (;;) {
        const { value, done } = await gen.next();
        if (done) {
          reason = value.reason;
          const lastAssistant = [...value.messages]
            .reverse()
            .find((m) => m.role === 'assistant' && m.content.trim());
          finalText = lastAssistant?.content ?? '';
          break;
        }
        deps.publish(value as never);
      }

      deps.publish({
        type: 'subagent-done',
        agentId: childId,
        name: displayName,
        ok: reason === 'complete',
        durationMs: Date.now() - startedAt,
      });

      if (deps.parentSignal?.aborted || reason === 'aborted') {
        throw Object.assign(new Error('subagent aborted'), { name: 'AbortError' });
      }

      const header = `[${displayName} · ${persona.name} · ${reason}]`;
      return `${header}\n${finalText || '(nincs szöveges válasz)'}`;
    },
  };
}
