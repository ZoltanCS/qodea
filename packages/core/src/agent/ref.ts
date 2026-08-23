import type { AgentEvent, AgentRunOptions, AgentRunResult } from './loop.js';

export type { AgentEvent, AgentRunOptions, AgentRunResult };

/** Runtime reference to runAgent — breaks the spawn-tool ↔ loop import cycle. */
export const runAgentRef: {
  current: (
    opts: AgentRunOptions,
  ) => AsyncGenerator<AgentEvent, AgentRunResult, unknown>;
} = { current: null as never };

/** Recognizes abort/cancel exceptions from any provider SDK. */
export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; message?: string };
  return (
    e.name === 'AbortError' ||
    e.name === 'APIUserAbortError' ||
    /abort|cancel/i.test(e.message ?? '')
  );
}
