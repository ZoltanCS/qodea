import type { ProviderKind } from '../types.js';

export interface Preset {
  label: string;
  baseUrl?: string;
  apiKeyEnv: string;
}

/**
 * Built-in connection presets per provider kind.
 * Entries in ~/.qodea/config.json can override any of these.
 */
export const PROVIDER_PRESETS: Record<ProviderKind, Preset> = {
  azure: {
    label: 'Azure OpenAI',
    apiKeyEnv: 'AZURE_OPENAI_API_KEY',
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
  },
  cerebras: {
    label: 'Cerebras',
    baseUrl: 'https://api.cerebras.ai/v1',
    apiKeyEnv: 'CEREBRAS_API_KEY',
  },
  zen: {
    label: 'OpenCode Zen',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    apiKeyEnv: 'OPENCODE_API_KEY',
  },
  'openai-compatible': {
    label: 'OpenAI-compatible',
    // no default baseUrl — must be provided in the config entry
    apiKeyEnv: 'QODEA_COMPAT_API_KEY',
  },
  anthropic: {
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
  },
};
