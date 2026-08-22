import type { ProviderEntry } from '../config/schema.js';
import type { Provider } from '../types.js';
import { AnthropicProvider } from './anthropic.js';
import { AzureProvider } from './azure.js';
import { OpenAICompatProvider } from './openai-compat.js';

/** Builds the concrete adapter for a config entry. */
export function createProvider(entry: ProviderEntry): Provider {
  switch (entry.kind) {
    case 'azure':
      return new AzureProvider(entry);
    case 'anthropic':
      return new AnthropicProvider(entry);
    default:
      // openai / cerebras / zen / openai-compatible all speak chat-completions
      return new OpenAICompatProvider(entry);
  }
}
