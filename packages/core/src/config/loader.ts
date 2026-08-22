import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PROVIDER_PRESETS } from '../providers/presets.js';
import {
  configSchema,
  type ProviderEntry,
  type QodeaConfig,
} from './schema.js';

/** Qodea's global home dir. Override with QODEA_HOME (tests, portable installs). */
export function qodeaDir(): string {
  return process.env.QODEA_HOME ?? path.join(os.homedir(), '.qodea');
}

export function configPath(): string {
  return path.join(qodeaDir(), 'config.json');
}

function emptyConfig(): QodeaConfig {
  return { version: 1, providers: [] };
}

/**
 * Loads and validates ~/.qodea/config.json.
 * Missing file → empty config (env-detected providers kick in via getEffectiveProviders).
 */
export async function loadConfig(file: string = configPath()): Promise<QodeaConfig> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return emptyConfig();
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }

  const result = configSchema.safeParse(parsedJson);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid config at ${file}: ${issues}`);
  }
  return result.data;
}

/**
 * Detects provider entries from well-known environment variables,
 * used when the user has no config file yet.
 */
export function detectProvidersFromEnv(env: NodeJS.ProcessEnv = process.env): ProviderEntry[] {
  const entries: ProviderEntry[] = [];

  if (env['AZURE_OPENAI_API_KEY'] && env['AZURE_OPENAI_ENDPOINT']) {
    entries.push({
      id: 'azure',
      kind: 'azure',
      azure: {
        endpoint: env['AZURE_OPENAI_ENDPOINT'],
        apiVersion: env['AZURE_OPENAI_API_VERSION'] ?? '2024-10-21',
      },
    });
  }
  if (env['OPENAI_API_KEY']) entries.push({ id: 'openai', kind: 'openai' });
  if (env['ANTHROPIC_API_KEY']) entries.push({ id: 'anthropic', kind: 'anthropic' });
  if (env['CEREBRAS_API_KEY']) entries.push({ id: 'cerebras', kind: 'cerebras' });
  if (env['OPENCODE_API_KEY'] ?? env['ZEN_API_KEY']) entries.push({ id: 'zen', kind: 'zen' });

  return entries;
}

/** Config file entries win; otherwise fall back to env detection. */
export function getEffectiveProviders(config: QodeaConfig): ProviderEntry[] {
  return config.providers.length > 0 ? config.providers : detectProvidersFromEnv();
}

/**
 * API key resolution order:
 *   entry.apiKey → entry.apiKeyEnv env var → preset default env var
 */
export function resolveApiKey(entry: ProviderEntry, env: NodeJS.ProcessEnv = process.env): string {
  if (entry.apiKey) return entry.apiKey;

  const candidates = [entry.apiKeyEnv, PROVIDER_PRESETS[entry.kind].apiKeyEnv];
  for (const name of candidates) {
    if (!name) continue;
    const value = env[name];
    if (value) return value;
  }

  const tried = candidates.filter(Boolean).join(' or ');
  throw new Error(
    `[${entry.id}] missing API key. Set ${tried}, or put "apiKeyEnv"/"apiKey" into ~/.qodea/config.json.`,
  );
}
