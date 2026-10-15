import { PROVIDER_PRESETS } from './presets.js';
import type { ProviderEntry } from '../config/schema.js';
import { resolveApiKey } from '../config/loader.js';

/**
 * Lists model ids available at the provider's endpoint via GET /models.
 * Works with the OpenAI-compatible surface (OpenAI/Cerebras/Zen/Azure v1);
 * Anthropic gets its own header scheme.
 */
export async function fetchAvailableModels(entry: ProviderEntry): Promise<string[]> {
  // Zen's public catalogue does not require a key; inference still does.
  const isZen = entry.kind === 'zen' || entry.kind === 'zen-free';
  const key = isZen ? undefined : resolveApiKey(entry);

  if (entry.kind === 'anthropic') {
    const base = trimSlash(entry.baseUrl ?? PROVIDER_PRESETS.anthropic.baseUrl!);
    return parseModels(
      await fetchText(base + '/v1/models', {
        'x-api-key': key!,
        'anthropic-version': '2023-06-01',
      }),
    );
  }

  let base = entry.baseUrl;
  if (!base && entry.kind === 'azure') {
    const endpoint = entry.azure?.endpoint;
    if (endpoint) base = `${trimSlash(endpoint)}/openai/v1`;
  }
  if (!base) base = PROVIDER_PRESETS[entry.kind].baseUrl;

  if (!base) {
    throw new Error(`[${entry.id}] baseUrl is required to list models`);
  }

  // Azure's v1 gateway accepts both auth styles; sending both keeps every kind working.
  const models = parseModels(
    await fetchText(`${trimSlash(base)}/models`, {
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      ...(entry.kind === 'azure' && key ? { 'api-key': key } : {}),
    }),
  );
  return entry.kind === 'zen-free' ? models.filter(isFreeZenChatModel) : models;
}

async function fetchText(url: string, headers: Record<string, string>): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  } catch (err) {
    throw new Error(`Cannot reach ${url}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Model list failed (HTTP ${res.status}): ${body.slice(0, 200)}`);
  }
  return body;
}

export function isFreeZenChatModel(id: string): boolean {
  // Jev uses System One; Muse uses Responses. Neither is a Chat Completions model.
  return (id.endsWith('-free') || id === 'big-pickle') && !/^(?:jev-|muse-)/.test(id);
}

function parseModels(body: string): string[] {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new Error('Model list response was not valid JSON');
  }
  const data = (json as { data?: Array<{ id?: string }> } | null)?.data;
  if (!Array.isArray(data)) return [];
  return data
    .map((m) => m && typeof m === 'object' ? m.id : undefined)
    .filter((id): id is string => typeof id === 'string')
    .sort((a, b) => a.localeCompare(b));
}

function trimSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}
