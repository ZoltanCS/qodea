import OpenAI from 'openai';
import { isFreeZenChatModel } from './models.js';
import { resolveApiKey } from '../config/loader.js';
import type { ProviderEntry } from '../config/schema.js';
import { PROVIDER_PRESETS } from './presets.js';
import type {
  ChatRequest,
  Provider,
  ProviderKind,
  StopReason,
  StreamEvent,
  TurnMessage,
} from '../types.js';

interface CompatOptions {
  /** Pre-built client (used by AzureProvider). */
  client?: OpenAI;
  /** Override the kind reported by this instance. */
  kind?: ProviderKind;
}

/**
 * Shared adapter for every OpenAI chat-completions-compatible endpoint:
 * OpenAI, Cerebras, OpenCode Zen and any custom base_url.
 */
export class OpenAICompatProvider implements Provider {
  readonly id: string;
  readonly kind: ProviderKind;
  readonly label: string;
  protected readonly client: OpenAI;

  constructor(entry: ProviderEntry, options: CompatOptions = {}) {
    this.id = entry.id;
    this.kind = options.kind ?? entry.kind;
    this.label = entry.label ?? PROVIDER_PRESETS[this.kind].label;

    const apiKey = resolveApiKey(entry);
    if (options.client) {
      this.client = options.client;
      return;
    }

    const baseURL =
      entry.baseUrl ??
      PROVIDER_PRESETS[this.kind].baseUrl ??
      PROVIDER_PRESETS['openai-compatible'].baseUrl;

    if (!baseURL) {
      throw new Error(
        `[${entry.id}] "baseUrl" is required for kind "${this.kind}" — add it to ~/.qodea/config.json.`,
      );
    }
    this.client = new OpenAI({ apiKey, baseURL, timeout: 120_000, maxRetries: 2 });
  }

  protected modelFor(model: string): string {
    return model;
  }

  async *streamChat(req: ChatRequest): AsyncGenerator<StreamEvent, void, unknown> {
    const model = this.modelFor(req.model);
    if (this.kind === 'zen-free' && !isFreeZenChatModel(model)) {
      throw Object.assign(new Error('Choose a free Chat Completions model from the OpenCode Zen (Free) model list.'), { status: 400 });
    }

    const body: OpenAI.ChatCompletionCreateParamsStreaming = {
        model,
        stream: true,
        messages: req.messages.map(toWireMessage),
        ...(req.tools && req.tools.length > 0
          ? {
              tools: req.tools.map((t) => ({
                type: 'function' as const,
                function: {
                  name: t.name,
                  description: t.description,
                  parameters: t.parametersJsonSchema,
                },
              })),
            }
          : {}),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(req.reasoningEffort ? { reasoning_effort: req.reasoningEffort } : {}),
        ...(req.maxTokens !== undefined
          ? this.kind === 'openai' ? { max_completion_tokens: req.maxTokens } : { max_tokens: req.maxTokens }
          : {}),
      };
    let stream;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        stream = await this.client.chat.completions.create(body, { signal: req.signal });
        break;
      } catch (error) {
        const e = error as { status?: number; message?: string; param?: string };
        const detail = `${e.param ?? ''} ${e.message ?? ''}`;
        if (e.status !== 400 || !/unsupported|not supported|not allowed|only.*supported|unknown parameter/i.test(detail)) throw error;
        // Negotiate optional features only. Never drop tools, messages or the model.
        if (/reasoning_effort/.test(detail) && body.reasoning_effort !== undefined) delete body.reasoning_effort;
        else if (/temperature/.test(detail) && body.temperature !== undefined) delete body.temperature;
        else if (/max_tokens/.test(detail) && body.max_tokens !== undefined) {
          body.max_completion_tokens = body.max_tokens;
          delete body.max_tokens;
        } else throw error;
      }
    }
    if (!stream) throw new Error('Provider rejected optional request parameters after compatibility retries');

    const pendingTools = new Map<number, { id: string; name: string; args: string }>();
    let usage: { inputTokens?: number; outputTokens?: number; cachedTokens?: number } | undefined;
    let finished = false;

    for await (const chunk of stream) {
      if (chunk.usage) {
        const details = (chunk.usage as { prompt_tokens_details?: { cached_tokens?: number } }).prompt_tokens_details;
        usage = {
          inputTokens: chunk.usage.prompt_tokens,
          outputTokens: chunk.usage.completion_tokens,
          cachedTokens: details?.cached_tokens,
        };
      }

      const choice = chunk.choices?.[0];
      if (!choice) continue;

      const delta = choice.delta as OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta & {
        reasoning_content?: string;
        reasoning?: string;
      };

      const reasoning = delta?.reasoning_content ?? delta?.reasoning;
      if (typeof reasoning === 'string' && reasoning.length > 0) {
        yield { type: 'reasoning-delta', text: reasoning };
      }

      if (delta?.content) yield { type: 'text-delta', text: delta.content };

      for (const tc of delta?.tool_calls ?? []) {
        const idx = tc.index ?? 0;
        let slot = pendingTools.get(idx);
        if (!slot) {
          slot = { id: tc.id ?? `call_${idx}`, name: '', args: '' };
          pendingTools.set(idx, slot);
        }
        if (tc.id) slot.id = tc.id;
        if (tc.function?.name && !slot.name) slot.name = tc.function.name;
        if (tc.function?.arguments) slot.args += tc.function.arguments;
      }

      if (choice.finish_reason && !finished) {
        finished = true;
        yield* flushTools(pendingTools);
        yield { type: 'done', stopReason: mapFinishReason(choice.finish_reason) };
      }
    }

    if (!finished) {
      throw new Error('stream ended unexpectedly before finish_reason');
    }
    if (usage) yield { type: 'usage', ...usage };
  }
}

function flushTools(
  pending: Map<number, { id: string; name: string; args: string }>,
): Generator<StreamEvent> {
  return (function* () {
    for (const [, slot] of [...pending.entries()].sort((a, b) => a[0] - b[0])) {
      yield {
        type: 'tool-call',
        id: slot.id,
        name: slot.name,
        argumentsJson: slot.args || '{}',
      };
    }
    pending.clear();
  })();
}

/**
 * Maps the internal transcript to OpenAI chat-completions wire messages,
 * including the tool-call / tool-result round trip (`role:"tool"`).
 */
export function toWireMessage(m: TurnMessage): OpenAI.ChatCompletionMessageParam {
  if (m.role === 'system') {
    return { role: 'system', content: m.content };
  }
  if (m.role === 'user') {
    const images = (m as { images?: string[] }).images ?? [];
    if (images.length > 0) {
      // vision content parts (OpenAI-compatible image_url format)
      return {
        role: 'user',
        content: [
          { type: 'text', text: m.content },
          ...images.map((img) => ({
            type: 'image_url' as const,
            image_url: { url: img },
          })),
        ],
      } as OpenAI.ChatCompletionMessageParam;
    }
    return { role: 'user', content: m.content };
  }
  if (m.role === 'assistant') {
    return {
      role: 'assistant',
      ...(m.content ? { content: m.content } : { content: null }),
      ...(m.toolCalls && m.toolCalls.length > 0
        ? {
            tool_calls: m.toolCalls.map((tc) => ({
              id: tc.id,
              type: 'function' as const,
              function: { name: tc.name, arguments: tc.argumentsJson },
            })),
          }
        : {}),
    };
  }
  // tool_result
  return {
    role: 'tool',
    tool_call_id: m.callId,
    content: m.content,
  };
}

function mapFinishReason(reason: string): StopReason {
  switch (reason) {
    case 'stop':
      return 'end';
    case 'tool_calls':
    case 'function_call':
      return 'tool-use';
    case 'length':
      return 'length';
    default:
      return 'other';
  }
}
