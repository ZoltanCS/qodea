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
