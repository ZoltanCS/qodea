import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  detectProvidersFromEnv,
  getEffectiveProviders,
  loadConfig,
  resolveApiKey,
} from '../src/index.js';
import type { QodeaConfig } from '../src/index.js';

describe('config loader', () => {
  it('returns an empty config when the file does not exist', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'qodea-test-'));
    const config = await loadConfig(path.join(dir, 'missing.json'));
    expect(config).toEqual({ version: 1, providers: [] });
  });

  it('parses and validates a config file', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'qodea-test-'));
    const file = path.join(dir, 'config.json');
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        defaultProvider: 'azure-main',
        providers: [
          {
            id: 'azure-main',
            kind: 'azure',
            azure: { endpoint: 'https://myres.openai.azure.com' },
          },
        ],
      }),
      'utf8',
    );

    const config = await loadConfig(file);
    expect(config.defaultProvider).toBe('azure-main');
    expect(config.providers).toHaveLength(1);
    // apiVersion default applied
    expect(config.providers[0]?.azure?.apiVersion).toBe('2024-10-21');
  });

  it('throws a readable error on invalid config', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'qodea-test-'));
    const file = path.join(dir, 'config.json');
    await writeFile(file, JSON.stringify({ version: 1, providers: [{ kind: 'nope' }] }), 'utf8');
    await expect(loadConfig(file)).rejects.toThrow(/Invalid config/);
  });
});

describe('provider resolution', () => {
  it('falls back to env detection when no entries are configured', () => {
    const env = { OPENAI_API_KEY: 'sk-x', OPENCODE_API_KEY: 'zen-x' };
    const entries = detectProvidersFromEnv(env);
    expect(entries.map((e) => e.id)).toEqual(['openai', 'zen']);
  });

  it('prefers explicit apiKey, then env var; throws helpfully when absent', () => {
    const entry = {
      id: 'p',
      kind: 'openai-compatible' as const,
      baseUrl: 'https://x.example.com/v1',
      apiKeyEnv: 'MY_KEY',
      apiKey: 'inline-val',
    };

    expect(resolveApiKey(entry, { MY_KEY: 'env-val' })).toBe('inline-val');

    const withoutInline = { ...entry, apiKey: undefined };
    expect(resolveApiKey(withoutInline, { MY_KEY: 'env-val' })).toBe('env-val');

    expect(() => resolveApiKey(withoutInline, {})).toThrow(/missing API key/);
  });

  it('getEffectiveProviders prefers config entries over env detection', () => {
    const config: QodeaConfig = {
      version: 1,
      providers: [{ id: 'mine', kind: 'anthropic' }],
    };
    const entries = getEffectiveProviders(config);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe('mine');
  });
});
