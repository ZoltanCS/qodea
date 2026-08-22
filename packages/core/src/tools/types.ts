/** Shared types for Qodea's built-in tools. */

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

/**
 * Session-scoped agent state shared across tools.
 * Lives outside the LLM transcript on purpose.
 */
export interface AgentState {
  todos: TodoItem[];
  /** Remembered approvals within the session, e.g. "bash:npm". */
  approvedActions: Set<string>;
}

export function emptyAgentState(): AgentState {
  return { todos: [], approvedActions: new Set() };
}

export interface ToolContext {
  cwd: string;
  state: AgentState;
  signal?: AbortSignal;
}

/** Read tools never mutate; write tools require permission even in default mode. */
export type ToolKind = 'read' | 'write';

export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly kind: ToolKind;
  readonly parametersJsonSchema: Record<string, unknown>;
  /** Human-readable one-liner of THIS invocation, shown in permission prompts. */
  describe(args: Record<string, unknown>): string;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

export class ToolError extends Error {}

/** Thrown when the model passed malformed arguments. */
export class InvalidArgsError extends ToolError {}
