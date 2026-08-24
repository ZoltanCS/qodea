import Anthropic from '@anthropic-ai/sdk';
import { resolveApiKey } from '../config/loader.js';
import type { ProviderEntry } from '../config/schema.js';
import { PROVIDER_PRESETS } from './presets.js';
import type {
  ChatRequest,
  Provider,
  StopReason,
  StreamEvent,
  ToolCallReq,
  TurnMessage,
} from '../types.js';

/**
 * Maps the internal transcript to Anthropic wire messages:
 * assistant tool calls become `tool_use` blocks, results arrive as
 * `tool_result` blocks inside the following user message.
 */
export function toWireMessages(messages: TurnMessage[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];

  for (const m of messages) {
    if (m.role === 'system') continue;

    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
      continue;
    }

    if (m.role === 'assistant') {
      const blocks: Anthropic.ContentBlockParam[] = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const tc of m.toolCalls ?? []) {
        blocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: parseJsonSafe(tc.argumentsJson),
        });
      }
      if (blocks.length === 0) blocks.push({ type: 'text', text: '(no content)' });
      out.push({ role: 'assistant', content: blocks });
      continue;
    }

    // tool_result — merge consecutive results into a single user message
    const block: Anthropic.ToolResultBlockParam = {
      type: 'tool_result',
      tool_use_id: m.callId,
      content: m.content,
      ...(m.isError ? { is_error: true } : {}),
    };
    const prev = out[out.length - 1];
    if (prev && prev.role === 'user' && Array.isArray(prev.content)) {
      (prev.content as Anthropic.ToolResultBlockParam[]).push(block);
    } else {
      out.push({ role: 'user', content: [block] });
    }
  }

  return out;
}

function parseJsonSafe(json: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Anthropic Messages API adapter (streaming). */
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
    const messages = toWireMessages(req.messages);

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

    let cachedTokens: number | undefined;
  let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let stopReason: StopReason = 'other';
    const pendingTools = new Map<number, { id: string; name: string; json: string }>();

    for await (const event of stream) {
      switch (event.type) {
        case 'message_start': {
          inputTokens = event.message.usage?.input_tokens;
          cachedTokens = (event.message.usage as { cache_read_input_tokens?: number } | undefined)
            ?.cache_read_input_tokens;
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

    yield { type: 'usage', inputTokens, outputTokens, cachedTokens };
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
