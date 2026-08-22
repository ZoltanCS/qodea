import type { Tool } from '../tools/types.js';

export type PermissionMode = 'read-only' | 'default' | 'yolo';

export interface PermissionAsk {
  tool: string;
  summary: string;
}

/** Returns true if the user (or host app) approves. */
export type PermissionAsker = (ask: PermissionAsk) => Promise<boolean>;

export interface Verdict {
  allowed: boolean;
  reason?: string;
}

/**
 * Central permission gate.
 *  - yolo: everything allowed, nothing asked
 *  - read-only: read tools pass, write tools denied outright
 *  - default: ask the host; approvals are remembered per action-key
 *    (bash is remembered per first command word, e.g. "npm")
 */
export class PermissionManager {
  constructor(
    private readonly mode: PermissionMode,
    private readonly state: { approvedActions: Set<string> },
    private readonly asker: PermissionAsker = autoDeny,
  ) {}

  async authorize(tool: Tool, args: Record<string, unknown>): Promise<Verdict> {
    switch (this.mode) {
      case 'yolo':
        return { allowed: true };
      case 'read-only': {
        return tool.kind === 'read'
          ? { allowed: true }
          : { allowed: false, reason: `session is in read-only mode` };
      }
      case 'default':
        break;
    }

    const key = actionKey(tool, args);
    if (this.state.approvedActions.has(key)) return { allowed: true };

    const approved = await this.asker({ tool: tool.name, summary: tool.describe(args) });
    if (!approved) return { allowed: false, reason: 'user declined' };

    this.state.approvedActions.add(key);
    return { allowed: true };
  }
}

/**
 * Session-scoped approval key. bash gets prefix granularity ("npm", "git"),
 * other tools are remembered by name.
 */
export function actionKey(tool: Tool, args: Record<string, unknown>): string {
  if (tool.name === 'bash') {
    const command = typeof args['command'] === 'string' ? args['command'].trim() : '';
    const firstWord = command.split(/\s+/)[0] ?? '';
    return `bash:${firstWord}`;
  }
  return tool.name;
}

async function autoDeny(): Promise<boolean> {
  return false;
}
