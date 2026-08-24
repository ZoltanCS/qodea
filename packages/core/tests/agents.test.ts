import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  runAgent,
  PERSONAS,
  type AgentEvent,
  type ChatRequest,
  type Provider,
  type StreamEvent,
  type ToolSpec,
} from '../src/index.js';
import { FakeProvider } from './fake-provider.js';
import { mergeAgents } from '../src/index.js';

const dirs: string[] = [];
afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

async function workspace(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'qodea-multi-'));
  dirs.push(dir);
  return dir;
}

function scriptOf(req: ChatRequest): StreamEvent[] {
  const lastUser = [...req.messages].reverse().find((m) => m.role === 'user');
  const text = lastUser?.content ?? '';

  // child runs answer with a marker line
  if (req.messages.some((m) => m.role === 'system' && m.content.includes('Explorer,'))) {
    return [
      { type: 'text-delta', text: `EXPLORER-REPORT for: ${text.slice(0, 30)}` },
      { type: 'done', stopReason: 'end' },
    ];
  }

  // parent: first turn spawns two agents in parallel; second turn wraps up
  const hasToolResult = req.messages.some((m) => m.role === 'tool_result');
  if (!hasToolResult) {
    return [
      {
        type: 'tool-call',
        id: 'p1',
        name: 'spawn_agent',
        argumentsJson: JSON.stringify({
          agent: 'explorer',
          name: 'Kódbázis felderítő',
          task: 'térképezd fel a repót',
        }),
      },
      {
        type: 'tool-call',
        id: 'p2',
        name: 'spawn_agent',
        argumentsJson: JSON.stringify({
          agent: 'reviewer',
          task: 'nézd át a változásokat',
        }),
      },
      { type: 'done', stopReason: 'tool-use' },
    ];
  }
  return [{ type: 'text-delta', text: 'Összefoglaltam a két jelentést.' }, { type: 'done', stopReason: 'end' }];
}

describe('multi-agent', () => {
  it('runs parallel subagents with restricted tools and feeds summaries back', async () => {
    const cwd = await workspace();

    let parentTools: ToolSpec[] | undefined;
    let childToolsSeen: string[][] = [];
    let sawStart = 0;
    let sawDone = 0;

    const makeProvider = (): Provider =>
      new (class extends FakeProvider {
        constructor() {
          super(scriptOf);
        }
        override async *streamChat(req: ChatRequest): AsyncGenerator<StreamEvent, void, unknown> {
          const sys = req.messages.find((m) => m.role === 'system')?.content ?? '';
          const isChild = /You are (Explorer|Reviewer),/.test(sys);
          if (!isChild) {
            if (!parentTools) parentTools = req.tools;
          } else {
            childToolsSeen.push((req.tools ?? []).map((t) => t.name));
          }
          for (const ev of this.script(req, this.requests.length - 1)) yield ev;
        }
      })();

    const provider = makeProvider();
    const events: AgentEvent[] = [];
    const gen = runAgent({
      provider,
      model: 'test-model',
      task: 'kutass és review-zz párhuzamosan',
      cwd,
      mode: 'yolo',
      agents: mergeAgents(),
    });

    for (;;) {
      const n = await gen.next();
      if (n.done) {
        expect(n.value.reason).toBe('complete');
        break;
      }
      events.push(n.value);
      if (n.value.type === 'subagent-start') sawStart++;
      if (n.value.type === 'subagent-done') sawDone++;
    }

    expect(sawStart).toBe(2);
    expect(sawDone).toBe(2);

    // both children ran with restricted toolsets (no write tools)
    expect(childToolsSeen.length).toBeGreaterThanOrEqual(2);
    for (const names of childToolsSeen) {
      expect(names).not.toContain('write_file');
      expect(names).not.toContain('spawn_agent'); // flat hierarchy
    }

    // parent got both reports back
    const results = events.filter(
      (e): e is Extract<AgentEvent, { type: 'tool-result' }> => e.type === 'tool-result',
    );
    const joined = results.map((r) => r.content).join('\n');
    expect(joined).toContain('EXPLORER-REPORT');

    // persona colors surfaced on start events
    const starts = events.filter(
      (e): e is Extract<AgentEvent, { type: 'subagent-start' }> => e.type === 'subagent-start',
    );
    expect(starts.map((s) => s.color)).toContain(PERSONAS.explorer.color);
    expect(starts.find((s) => s.personaId === 'explorer')?.name).toBe('Kódbázis felderítő');
  });

  it('children cannot spawn further agents (flat hierarchy)', async () => {
    const cwd = await workspace();

    const provider = new (class extends FakeProvider {
      constructor() {
        super((req) => {
          const isChild = (req.messages.some((m) => m.role === 'system') ?? '').valueOf();
          void isChild;
          return [] as StreamEvent[];
        });
      }
      override async *streamChat(req: ChatRequest): AsyncGenerator<StreamEvent, void, unknown> {
        const sys = req.messages.find((m) => m.role === 'system')?.content ?? '';
        if (sys.includes('Explorer,')) {
          // the child tries to recurse
          yield {
            type: 'tool-call',
            id: 'c1',
            name: 'spawn_agent',
            argumentsJson: JSON.stringify({ agent: 'worker', task: 'nope' }),
          };
          yield { type: 'done', stopReason: 'tool-use' };
          return;
        }
        const first = this.requests.length <= 1;
        if (first) {
          yield {
            type: 'tool-call',
            id: 'p1',
            name: 'spawn_agent',
            argumentsJson: JSON.stringify({ agent: 'explorer', task: 'x' }),
          };
          yield { type: 'done', stopReason: 'tool-use' };
        } else {
          yield { type: 'text-delta', text: 'kész' };
          yield { type: 'done', stopReason: 'end' };
        }
      }
    })();

    // capture what tools the child actually received
    let childTools: string[] | null = null;
    const origStream = provider.streamChat.bind(provider);
    (provider as unknown as { streamChat: typeof provider.streamChat }).streamChat = function (
      this: Provider,
      req: ChatRequest,
    ) {
      const sys = req.messages.find((m) => m.role === 'system')?.content ?? '';
      if (sys.includes('Explorer,') && !childTools) {
        childTools = (req.tools ?? []).map((t) => t.name);
      }
      return origStream(req);
    } as typeof provider.streamChat;

    const gen = runAgent({
      provider,
      model: 'm',
      task: 'indíts egy explorert',
      cwd,
      mode: 'yolo',
      agents: mergeAgents(),
    });

    const events: AgentEvent[] = [];
    for (;;) {
      const n = await gen.next();
      if (n.done) break;
      events.push(n.value);
    }

    expect(childTools).not.toBeNull();
    expect(childTools!.includes('spawn_agent')).toBe(false);

    // child's spawn attempt came back as an error tool result inside its own run
    const errResult = events.find(
      (e): e is Extract<AgentEvent, { type: 'tool-result' }> =>
        e.type === 'tool-result' && e.isError && e.name === 'spawn_agent',
    );
    expect(errResult).toBeDefined();
    expect(errResult!.content).toMatch(/Unknown agent|Unknown tool/i);
  });
});
