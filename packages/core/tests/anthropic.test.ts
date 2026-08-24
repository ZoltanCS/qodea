import { afterAll, describe, expect, it } from 'vitest';
import { AnthropicProvider } from '../src/index.js';
import { startSseServer, type MockSseServer } from './helpers.js';

const servers: MockSseServer[] = [];

afterAll(() => {
  for (const s of servers) s.server.close();
});

describe('AnthropicProvider', () => {
  it('normalizes message stream events and lifts system messages', async () => {
    const ssePayload = [
      'event: message_start',
      'data: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","content":[],"usage":{"input_tokens":17,"output_tokens":1}}}',
      '',
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi "}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"there"}}',
      '',
      'event: content_block_stop',
      'data: {"type":"content_block_stop","index":0}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":9}}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}',
      '',
    ].join('\n');

    const mock = await startSseServer(() => ssePayload);
    servers.push(mock);

    const provider = new AnthropicProvider({
      id: 'mock-anthropic',
      kind: 'anthropic',
      baseUrl: mock.url,
      apiKey: 'test-key',
    });

    const events: unknown[] = [];
    for await (const ev of provider.streamChat({
      model: 'claude-test',
      messages: [
        { role: 'system', content: 'be terse' },
        { role: 'user', content: 'hello' },
      ],
    })) {
      events.push(ev);
    }

    expect(events).toEqual([
      { type: 'text-delta', text: 'Hi ' },
      { type: 'text-delta', text: 'there' },
      { type: 'usage', inputTokens: 17, outputTokens: 9 },
      { type: 'done', stopReason: 'end' },
    ]);

    // system must be top-level, not inside messages
    const sent = JSON.parse(mock.requests[0] ?? '{}') as {
      system?: string;
      messages?: Array<{ role: string }>;
    };
    // system is now a cached content-block array
    const sentSystem = sent.system as unknown as Array<{ text: string }>;
    expect(sentSystem[0]?.text).toBe('be terse');
    expect(sent.messages).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('emits accumulated tool_use blocks as tool-call events', async () => {
    const ssePayload = [
      'event: message_start',
      'data: {"type":"message_start","message":{"id":"msg_2","type":"message","role":"assistant","content":[],"usage":{"input_tokens":20,"output_tokens":3}}}',
      '',
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"read_file","input":{}}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":"}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"\\"a.txt\\"}"}}',
      '',
      'event: content_block_stop',
      'data: {"type":"content_block_stop","index":0}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":12}}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}',
      '',
    ].join('\n');

    const mock = await startSseServer(() => ssePayload);
    servers.push(mock);

    const provider = new AnthropicProvider({
      id: 'mock-anthropic-2',
      kind: 'anthropic',
      baseUrl: mock.url,
      apiKey: 'test-key',
    });

    const events: unknown[] = [];
    for await (const ev of provider.streamChat({
      model: 'claude-test',
      messages: [{ role: 'user', content: 'read it' }],
    })) {
      events.push(ev);
    }

    expect(events).toEqual([
      { type: 'tool-call', id: 'toolu_1', name: 'read_file', argumentsJson: '{"path":"a.txt"}' },
      { type: 'usage', inputTokens: 20, outputTokens: 12 },
      { type: 'done', stopReason: 'tool-use' },
    ]);
  });
});
