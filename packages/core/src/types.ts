/** Chat roles we expose to providers. System messages are mapped per-API. */
export type Role = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: Role;
  content: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  parametersJsonSchema: Record<string, unknown>;
}

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
}

export type StopReason = 'end' | 'tool-use' | 'length' | 'other';

/**
 * Normalized streaming events every provider adapter emits.
 * The M1 agent loop consumes exactly this — UI subscribes downstream.
 */
export type StreamEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; id: string; name: string; argumentsJson: string }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number }
  | { type: 'done'; stopReason: StopReason };

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export const providerKinds = [
  'azure',
  'openai',
  'cerebras',
  'zen',
  'openai-compatible',
  'anthropic',
] as const;

export type ProviderKind = (typeof providerKinds)[number];

export interface Provider {
  readonly id: string;
  readonly kind: ProviderKind;
  readonly label: string;
  streamChat(req: ChatRequest): AsyncGenerator<StreamEvent, void, unknown>;
}
