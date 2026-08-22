// ── types ────────────────────────────────────────────────────────────────────
export type {
  ChatMessage,
  ChatRequest,
  Provider,
  ProviderKind,
  Role,
  StopReason,
  StreamEvent,
  ToolSpec,
  Usage,
} from './types.js';
export { providerKinds } from './types.js';

// ── config ───────────────────────────────────────────────────────────────────
export {
  detectProvidersFromEnv,
  getEffectiveProviders,
  loadConfig,
  qodeaDir,
  resolveApiKey,
  configPath,
} from './config/loader.js';
export {
  configSchema,
  providerEntrySchema,
  type ProviderEntry,
  type QodeaConfig,
} from './config/schema.js';

// ── providers ────────────────────────────────────────────────────────────────
export { PROVIDER_PRESETS, type Preset } from './providers/presets.js';
export { createProvider } from './providers/factory.js';
export { OpenAICompatProvider } from './providers/openai-compat.js';
export { AzureProvider } from './providers/azure.js';
export { AnthropicProvider } from './providers/anthropic.js';
