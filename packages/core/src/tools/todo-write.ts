import { InvalidArgsError, type Tool } from './types.js';

const STATUSES = new Set(['pending', 'in_progress', 'completed']);

interface TodoArg {
  content: string;
  status: string;
}

export const todoWriteTool: Tool = {
  name: 'todo_write',
  description:
    'Replace the session task list. Use for multi-step tasks: plan first (all pending), mark in_progress when starting a step, completed when done. Keep it short — max ~8 items.',
  kind: 'read', // mutating only agent-internal state, not the filesystem
  parametersJsonSchema: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            content: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
          },
          required: ['content', 'status'],
        },
      },
    },
    required: ['todos'],
  },

  describe() {
    return 'update task list';
  },

  async run(rawArgs, ctx) {
    const todos = rawArgs['todos'];
    if (!Array.isArray(todos)) {
      throw new InvalidArgsError('todo_write requires a "todos" array');
    }

    const parsed: TodoArg[] = todos.map((item) => {
      if (typeof item !== 'object' || item === null) {
        throw new InvalidArgsError('each todo must be an object');
      }
      const content = (item as Record<string, unknown>)['content'];
      const status = (item as Record<string, unknown>)['status'];
      if (typeof content !== 'string' || typeof status !== 'string' || !STATUSES.has(status)) {
        throw new InvalidArgsError(
          `todo needs "content" string and "status" in pending|in_progress|completed`,
        );
      }
      return { content, status };
    });

    ctx.state.todos = parsed.map((t) => ({
      content: t.content,
      status: t.status as 'pending' | 'in_progress' | 'completed',
    }));

    if (ctx.state.todos.length === 0) return 'Task list cleared.';
    return renderTodos(ctx.state.todos);
  },
};

export function renderTodos(todos: { content: string; status: string }[]): string {
  const icon = (s: string) => (s === 'completed' ? '[x]' : s === 'in_progress' ? '[~]' : '[ ]');
  const body = todos.map((t) => `${icon(t.status)} ${t.content}`).join('\n');
  const done = todos.filter((t) => t.status === 'completed').length;
  return `Task list (${done}/${todos.length} done):\n${body}`;
}
