/** Token estimation — ~4 chars per token for code/English mix. Good enough for budgets. */

export function estimateTokens(text: string): number {
  return Math.ceil((text?.length ?? 0) / 4);
}

/** Rough per-section context breakdown (token estimates). */
export interface ContextBreakdown {
  system: number;
  tools: number;
  history: number;
  outputs: number;
}

export function estimateContextBreakdown(opts: {
  system: string;
  toolsJson: string;
  messages: Array<{ role: string; content: unknown }>;
}): ContextBreakdown {
  let history = 0;
  let outputs = 0;
  for (const m of opts.messages) {
    const size = estimateTokens(
      typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? ''),
    );
    if (m.role === 'tool_result') {
      outputs += size;
    } else {
      history += size;
    }
    if (m.role === 'assistant' && 'toolCalls' in m && Array.isArray(m.toolCalls)) {
      history += estimateTokens(JSON.stringify(m.toolCalls));
    }
  }
  return {
    system: estimateTokens(opts.system),
    tools: estimateTokens(opts.toolsJson),
    history,
    outputs,
  };
}
