import { describe, expect, it } from 'vitest';
import { runAgent, runAgentAuto, type AgentEvent, type AgentRunResult } from '../src/index.js';
import { FakeProvider, callTool, text } from './fake-provider.js';

async function drive(gen: AsyncGenerator<AgentEvent, AgentRunResult>) {
  const events: AgentEvent[] = [];
  for (;;) { const next = await gen.next(); if (next.done) return { events, result: next.value }; events.push(next.value); }
}
const common = { model: 'mock', cwd: process.cwd(), task: 'test', mode: 'yolo' as const, enableSubagents: false };

describe('runtime resilience', () => {
  it('preserves history and custom tools in the supervisor', async () => {
    const provider = new FakeProvider((req, index) => {
      expect(req.messages.filter(m => m.role === 'system')).toHaveLength(1);
      expect(req.messages.some(m => m.content === 'earlier goal')).toBe(true);
      expect(req.messages.some(m => m.role === 'user' && m.content.includes('[cwd:') && m.content.endsWith('test'))).toBe(true);
      expect(req.tools?.map(t => t.name)).toEqual(['test_tool']);
      return index === 0 ? callTool('one', 'test_tool', {}) : text('finished');
    });
    const tools = [{ name: 'test_tool', description: 'test', kind: 'read' as const, parametersJsonSchema: { type: 'object' }, describe: () => 'test', run: async () => 'result' }];
    const { result, events } = await drive(runAgentAuto({ ...common, provider, tools, initialMessages: [{ role: 'system', content: 'old' }, { role: 'user', content: 'earlier goal' }] }));
    expect(result.reason).toBe('complete');
    expect(events.filter(e => e.type === 'done')).toHaveLength(1);
    expect(tools).toHaveLength(1);
  });
  it('does not complete a truncated response', async () => {
    const provider = new FakeProvider(() => [{ type: 'text-delta', text: 'unfinished' }, { type: 'done', stopReason: 'length' }]);
    expect((await drive(runAgent({ ...common, provider }))).result.reason).toBe('max-turns');
  });
  it('rejects null tool arguments without crashing', async () => {
    const provider = new FakeProvider((req, i) => {
      if (!i) return [{ type: 'tool-call', id: 'bad', name: 'read_file', argumentsJson: 'null' }, { type: 'done', stopReason: 'tool-use' }];
      expect(req.messages.some(m => m.role === 'tool_result' && m.isError && m.content.includes('JSON object'))).toBe(true);
      return text('corrected');
    });
    expect((await drive(runAgent({ ...common, provider }))).result.reason).toBe('complete');
  });
  it('continues a truncated answer instead of claiming success', async () => {
    const provider = new FakeProvider((req, i) => i === 0
      ? [{ type: 'text-delta', text: 'partial' }, { type: 'done', stopReason: 'length' }]
      : text('finished'));
    const { result } = await drive(runAgentAuto({ ...common, provider }));
    expect(provider.requests).toHaveLength(2);
    expect(result.reason).toBe('complete');
  });

  it('stops on bad credentials without retrying', async () => {
    const provider = new FakeProvider(() => { throw Object.assign(new Error('invalid key'), { status: 401 }); });
    const { result, events } = await drive(runAgentAuto({ ...common, provider }));
    expect(result.reason).toBe('failed');
    expect(provider.requests).toHaveLength(1);
    expect(events.some(e => e.type === 'auto-restart')).toBe(false);
  });
  it('keeps completed tool results across a transient error', async () => {
    const provider = new FakeProvider((req, i) => {
      if (i === 0) return callTool('todo', 'todo_write', { todos: [{ content: 'step', status: 'completed' }] });
      if (i === 1) throw Object.assign(new Error('rate limit'), { status: 429, headers: { 'retry-after': '0' } });
      expect(req.messages.some(m => m.role === 'tool_result' && m.callId === 'todo')).toBe(true);
      return text('finished');
    });
    const { result } = await drive(runAgentAuto({ ...common, provider, restartBaseDelayMs: 1 }));
    expect(result.reason).toBe('complete');
    expect(result.state.todos[0]?.status).toBe('completed');
  });
});
