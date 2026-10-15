import type OpenAI from 'openai';
import { afterAll, describe, expect, it } from 'vitest';
import { OpenAICompatProvider } from '../src/index.js';
import { startSseServer, type MockSseServer } from './helpers.js';

const servers: MockSseServer[] = [];

async function start(respond: (body: string) => string): Promise<string> {
  const mock = await startSseServer(respond);
  servers.push(mock);
  return mock.url;
}

afterAll(() => {
  for (const s of servers) s.server.close();
});

function sse(chunks: unknown[]): string {
  return chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
}

describe('OpenAICompatProvider', () => {
  it('retries unsupported optional settings without dropping tools', async () => {
    const bodies: Record<string, unknown>[] = [];
    const client = { chat: { completions: { create: async (body: Record<string, unknown>) => {
      bodies.push({ ...body });
      if (body.reasoning_effort) throw Object.assign(new Error('Unsupported parameter: reasoning_effort'), { status: 400 });
      if (body.temperature !== undefined) throw Object.assign(new Error('temperature is not supported'), { status: 400 });
      return (async function* () { yield { choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }; })();
    } } } } as unknown as OpenAI;
    const provider = new OpenAICompatProvider({ id: 'test', kind: 'openai-compatible', apiKey: 'test' }, { client });
    const events = await collect(provider.streamChat({ ...chatReq(), reasoningEffort: 'high', temperature: 0.2,
      tools: [{ name: 'read', description: 'read', parametersJsonSchema: { type: 'object' } }] }));
    expect(bodies).toHaveLength(3);
    expect(bodies.every(body => Array.isArray(body.tools) && body.model === 'test-model')).toBe(true);
    expect(events).toContainEqual({ type: 'text-delta', text: 'ok' });
  });

  it('rejects a stream that ends before a finish reason', async () => {
    const baseUrl = await start(() => sse([{ choices: [{ delta: { content: 'partial' } }] }]));
    const provider = new OpenAICompatProvider({ id: 'test', kind: 'openai-compatible', baseUrl, apiKey: 'test' });
    await expect(collect(provider.streamChat(chatReq()))).rejects.toThrow('stream ended unexpectedly');
  });

  it('normalizes text streaming into StreamEvents', async () => {
    const baseUrl = await start(() =>
      sse([
        { id: 'c1', choices: [{ index: 0, delta: { role: 'assistant', content: 'Hell' } }] },
        { id: 'c1', choices: [{ index: 0, delta: { content: 'o world' } }] },
        { id: 'c1', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
        { id: 'c1', choices: [], usage: { prompt_tokens: 11, completion_tokens: 7 } },
      ]),
    );

    const provider = new OpenAICompatProvider({
      id: 'mock',
      kind: 'openai-compatible',
      baseUrl,
      apiKey: 'test-key',
    });

    const events = [...(await collect(provider.streamChat(chatReq())))]
    expect(events).toEqual([
      { type: 'text-delta', text: 'Hell' },
      { type: 'text-delta', text: 'o world' },
      { type: 'done', stopReason: 'end' },
      { type: 'usage', inputTokens: 11, outputTokens: 7 },
    ]);
  });

  it('accumulates fragmented tool-call deltas into one complete event', async () => {
    const baseUrl = await start(() =>
      sse([
        {
          id: 'c2',
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [
                  { index: 0, id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"cit' } },
                ],
              },
            },
          ],
        },
        {
          id: 'c2',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [{ index: 0, function: { arguments: 'y":"Budapest"}' } }],
              },
            },
          ],
        },
        { id: 'c2', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
      ]),
    );

    const provider = new OpenAICompatProvider({
      id: 'mock',
      kind: 'cerebras',
      baseUrl,
      apiKey: 'test-key',
    });

    const events = [...(await collect(provider.streamChat(chatReq())))];
    expect(events).toEqual([
      { type: 'tool-call', id: 'call_1', name: 'get_weather', argumentsJson: '{"city":"Budapest"}' },
      { type: 'done', stopReason: 'tool-use' },
    ]);
  });

  it('sends reasoning_effort on the wire when requested', async () => {
    const baseUrl = await start((body) => {
      const parsed = JSON.parse(body) as { reasoning_effort?: string };
      expect(parsed.reasoning_effort).toBe('high');
      return sse([{ id: 'c3', choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }] }]);
    });

    const provider = new OpenAICompatProvider({
      id: 'mock',
      kind: 'openai-compatible',
      baseUrl,
      apiKey: 'test-key',
    });

    await collect(
      provider.streamChat({ ...chatReq(), reasoningEffort: 'high' }),
    );
  });

  it('streams reasoning_content deltas as reasoning-delta events', async () => {
    const baseUrl = await start(() =>
      sse([
        { id: 'c4', choices: [{ index: 0, delta: { reasoning_content: 'thinking ' } }] },
        { id: 'c4', choices: [{ index: 0, delta: { reasoning_content: 'hard...' } }] },
        { id: 'c4', choices: [{ index: 0, delta: { content: 'Answer' } }] },
        { id: 'c4', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
      ]),
    );

    const provider = new OpenAICompatProvider({
      id: 'mock',
      kind: 'openai-compatible',
      baseUrl,
      apiKey: 'test-key',
    });

    const events = [...(await collect(provider.streamChat(chatReq())))];
    expect(events).toEqual([
      { type: 'reasoning-delta', text: 'thinking ' },
      { type: 'reasoning-delta', text: 'hard...' },
      { type: 'text-delta', text: 'Answer' },
      { type: 'done', stopReason: 'end' },
    ]);
  });
});

function chatReq() {
  return {
    model: 'test-model',
    messages: [{ role: 'user' as const, content: 'hello' }],
  };
}

async function collect(gen: AsyncGenerator<unknown>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}
