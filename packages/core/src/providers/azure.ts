import { AzureOpenAI } from 'openai';
import { resolveApiKey } from '../config/loader.js';
import type { ProviderEntry } from '../config/schema.js';
import { OpenAICompatProvider } from './openai-compat.js';

/**
 * Azure OpenAI adapter.
 *
 * Azure differs from vanilla OpenAI in two ways:
 *  - auth goes through the deployment endpoint (`api-key` header, handled by the SDK)
 *  - the "model" wire parameter is actually the *deployment* name configured in the portal
 */
export class AzureProvider extends OpenAICompatProvider {
  private readonly deployment?: string;

  constructor(entry: ProviderEntry) {
    const az = entry.azure;
    if (!az) {
      throw new Error(
        `[${entry.id}] missing "azure" section in config (endpoint + apiVersion required).`,
      );
    }

    const client = new AzureOpenAI({
      endpoint: az.endpoint,
      apiKey: resolveApiKey(entry),
      apiVersion: az.apiVersion,
    });

    super(entry, { client });
    this.deployment = az.deployment;
  }

  protected override modelFor(model: string): string {
    return this.deployment ?? model;
  }
}
