import type {
  ChatRequest,
  Provider,
  ProviderKind,
  StreamEvent,
} from '../src/index.js';

/**
 * Scripted provider for agent-loop tests: each streamChat() call gets the
 * full request and returns the next batch of events from the script function.
 */
export class FakeProvider implements Provider {
  readonly id = 'fake';
  readonly kind: ProviderKind = 'openai-compatible';
  readonly label = 'Fake';
  readonly requests: ChatRequest[] = [];
  private callIndex = 0;

  constructor(
    protected readonly script: (req: ChatRequest, callIndex: number) => StreamEvent[],
  ) {}

  async *streamChat(req: ChatRequest): AsyncGenerator<StreamEvent, void, unknown> {
    const index = this.callIndex++;
    this.requests.push(req);
    for (const event of this.script(req, index)) {
      yield event;
    }
  }
}

export const done = (stopReason: 'end' | 'tool-use' = 'end'): StreamEvent => ({
  type: 'done',
  stopReason,
});

export const text = (t: string): StreamEvent[] => [{ type: 'text-delta', text: t }, done('end')];

export const callTool = (
  id: string,
  name: string,
  args: Record<string, unknown>,
): StreamEvent[] => [
  { type: 'tool-call', id, name, argumentsJson: JSON.stringify(args) },
  done('tool-use'),
];
