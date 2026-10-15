import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAvailableModels } from '../src/providers/models.js';
import { OpenAICompatProvider } from '../src/providers/openai-compat.js';
import { PROVIDER_PRESETS } from '../src/providers/presets.js';
import { providerEntrySchema } from '../src/config/schema.js';

afterEach(() => vi.unstubAllGlobals());

describe('OpenCode Zen Free', () => {
  it('loads the public catalogue without credentials and filters unsupported/paid models', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ data: [
      { id: 'gpt-6-sol' }, { id: 'big-pickle' }, { id: 'space-bunny-free' },
      { id: 'jev-1.13-free' }, { id: 'muse-spark-1.3-contributor-free' },
      { id: 'new-chat-model-free' }, null,
    ] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchAvailableModels({ id: 'zen-free', kind: 'zen-free' })).toEqual([
      'big-pickle', 'new-chat-model-free', 'space-bunny-free',
    ]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://opencode.ai/zen/v1/models');
  });

  it('does not substitute paid models when the free catalogue is empty', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'paid' }] }))));
    expect(await fetchAvailableModels({ id: 'free', kind: 'zen-free' })).toEqual([]);
  });

  it('preserves the full list for normal Zen', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'paid' }, { id: 'chat-free' }] }))));
    expect(await fetchAvailableModels({ id: 'zen', kind: 'zen' })).toEqual(['chat-free', 'paid']);
  });

  it('rejects manually entered paid models before making an inference request', async () => {
    const provider = new OpenAICompatProvider({ id: 'free', kind: 'zen-free', apiKey: 'test' });
    const gen = provider.streamChat({ model: 'paid-model', messages: [{ role: 'user', content: 'test' }] });
    await expect(gen.next()).rejects.toThrow('Choose a free Chat Completions model');
  });

  it('validates and resolves the dedicated preset', () => {
    expect(providerEntrySchema.parse({ id: 'free', kind: 'zen-free' }).kind).toBe('zen-free');
    expect(PROVIDER_PRESETS['zen-free'].baseUrl).toBe('https://opencode.ai/zen/v1');
  });
});
