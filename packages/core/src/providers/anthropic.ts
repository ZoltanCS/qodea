import Anthropic from '@anthropic-ai/sdk';
import { resolveApiKey } from '../config/loader.js';
import type { ProviderEntry } from '../config/schema.js';
import { PROVIDER_PRESETS } from './presets.js';
import type {
  ChatRequest,
  Provider,
  StopReason,
  StreamEvent,
} from '../types.js';

/**
 * Anthropic Messages API adapter (streaming).
 * System messages are lifted to the top-level `system` param per Anthropic convention.
 */
export class AnthropicProvider implements Provider {
  readonly id: string;
  readonly kind = 'anthropic' as const;
  readonly label: string;

  private readonly client: Anthropic;

  constructor(entry: ProviderEntry) {
    this.id = entry.id;
    this.label = entry.label ?? PROVIDER_PRESETS.anthropic.label;
    const apiKey = resolveApiKey(entry);
    const baseURL =
      entry.baseUrl ??
      PROVIDER_PRESETS.anthropic.baseUrl ??
      'https://api.anthropic.com';
    this.client = new Anthropic({ apiKey, baseURL });
  }

  async *streamChat(req: ChatRequest): AsyncGenerator<StreamEvent, void, unknown> {
    const systemText = req.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');

    const messages: Anthropic.MessageParam[] = req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        content: m.content,
      }));

    const stream = this.client.messages.stream(
      {
        model: req.model,
        max_tokens: req.maxTokens ?? 4096,
        ...(systemText ? { system: systemText } : {}),
        messages,
        ...(req.tools && req.tools.length > 0
          ? {
              tools: req.tools.map((t) => ({
                name: t.name,
                description: t.description,
                input_schema: t.parametersJsonSchema as Anthropic.Tool.InputSchema,
              })),
            }
          : {}),
      },
      { signal: req.signal },
    );

    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let stopReason: StopReason = 'other';
    const pendingTools = new Map<number, { id: string; name: string; json: string }>();

    for await (const event of stream) {
      switch (event.type) {
        case 'message_start': {
          inputTokens = event.message.usage?.input_tokens;
          break;
        }
        case 'content_block_start': {
          if (event.content_block.type === 'tool_use') {
            pendingTools.set(event.index, {
              id: event.content_block.id,
              name: event.content_block.name,
              json: '',
            });
          }
          break;
        }
        case 'content_block_delta': {
          if (event.delta.type === 'text_delta') {
            yield { type: 'text-delta', text: event.delta.text };
          } else if (event.delta.type === 'input_json_delta') {
            const slot = pendingTools.get(event.index);
            if (slot) slot.json += event.delta.partial_json;
          }
          break;
        }
        case 'content_block_stop': {
          const slot = pendingTools.get(event.index);
          if (slot) {
            yield {
              type: 'tool-call',
              id: slot.id,
              name: slot.name,
              argumentsJson: slot.json || '{}',
            };
            pendingTools.delete(event.index);
          }
          break;
        }
        case 'message_delta': {
          outputTokens = event.usage?.output_tokens;
          stopReason = mapStopReason(event.delta.stop_reason);
          break;
        }
        // message_stop / ping / other block types need no handling here
      }
    }

    yield { type: 'usage', inputTokens, outputTokens };
    yield { type: 'done', stopReason };
  }
}

function mapStopReason(reason: string | null): StopReason {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'end';
    case 'tool_use':
      return 'tool-use';
    case 'max_tokens':
      return 'length';
    default:
      return 'other';
  }
}
