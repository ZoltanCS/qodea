import { z } from 'zod';

export const providerKinds = [
  'azure',
  'openai',
  'cerebras',
  'zen',
  'openai-compatible',
  'anthropic',
] as const;

export const providerEntrySchema = z.object({
  id: z.string().min(1),
  kind: z.enum(providerKinds),
  label: z.string().optional(),
  baseUrl: z.string().url().optional(),
  /** Inline key — works, but prefer apiKeyEnv; desktop will move these into OS keychain storage. */
  apiKey: z.string().optional(),
  /** Name of the environment variable holding the API key. */
  apiKeyEnv: z.string().optional(),
  defaultModel: z.string().optional(),
  /** Context window size in tokens — powers the UI's usage ring (default 131072). */
  contextWindow: z.number().int().positive().optional(),
  azure: z
    .object({
      endpoint: z.string().url(),
      apiVersion: z.string().default('2024-10-21'),
      deployment: z.string().optional(),
    })
    .optional(),
});

export const configSchema = z.object({
  version: z.literal(1).default(1),
  defaultProvider: z.string().optional(),
  providers: z.array(providerEntrySchema).default([]),
  web: z
    .object({
      searxngUrl: z.string().url().optional(),
    })
    .optional(),
});

export type ProviderEntry = z.infer<typeof providerEntrySchema>;
export type QodeaConfig = z.infer<typeof configSchema>;
