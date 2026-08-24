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

/** A tool call requested by the model. */
export interface ToolCallReq {
  id: string;
  name: string;
  argumentsJson: string;
}

/**
 * Internal transcript format — richer than the wire formats.
 * Provider adapters map this to OpenAI (`role:"tool"`) or Anthropic
 * (`tool_result` blocks) conventions.
 */
export type TurnMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string; images?: string[] }
  | { role: 'assistant'; content: string; toolCalls?: ToolCallReq[] }
  | {
      role: 'tool_result';
      callId: string;
      name: string;
      content: string;
      isError?: boolean;
    };

export function userMessage(content: string): TurnMessage {
  return { role: 'user', content };
}

/** User message carrying attached images (data-URIs or https URLs). */
export function userMessageWithImages(content: string, images: string[]): TurnMessage {
  return { role: 'user', content, images };
}

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  /** Prompt tokens served from cache (OpenAI/Anthropic detail fields). */
  cachedTokens?: number;
}

export type StopReason = 'end' | 'tool-use' | 'length' | 'other';

/**
 * Normalized streaming events every provider adapter emits.
 * The agent loop consumes exactly this — UI subscribes downstream.
 */
export type StreamEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'reasoning-delta'; text: string }
  | { type: 'tool-call'; id: string; name: string; argumentsJson: string }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number; cachedTokens?: number }
  | { type: 'done'; stopReason: StopReason };

export interface ChatRequest {
  model: string;
  messages: TurnMessage[];
  tools?: ToolSpec[];
  temperature?: number;
  maxTokens?: number;
  /** Reasoning effort for thinking models ('low' | 'medium' | 'high'), mapped per-API. */
  reasoningEffort?: 'low' | 'medium' | 'high';
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
