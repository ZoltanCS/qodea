import type { AgentEvent, AgentRunResult, PermissionMode } from '@qodea/core';

export interface ProviderInfo {
  id: string;
  kind: string;
  label: string;
  baseUrl: string | null;
  defaultModel: string | null;
  azureDeployment: string | null;
  contextWindow?: number;
}

export interface StartRequest {
  task: string;
  providerId?: string;
  model?: string;
  mode: PermissionMode;
  cwd: string;
  reasoningEffort?: 'low' | 'medium' | 'high';
  history?: unknown[];
}

export type WireEvent =
  | AgentEvent
  | { type: 'permission-request'; requestId: string; tool: string; summary: string }
  | ({ type: 'session-done' } & Pick<AgentRunResult, 'reason' | 'turns' | 'messages'> & {
      todos: Array<{ content: string; status: string }>;
    })
  | { type: 'session-error'; message: string };

declare global {
  interface Window {
    qodea: {
      listProviders(): Promise<{
        defaultProvider: string | null;
        providers: ProviderInfo[];
      }>;
      startSession(req: StartRequest): Promise<{ sessionId: string }>;
      respondPermission(sessionId: string, requestId: string, approved: boolean): Promise<void>;
      stopSession(sessionId: string): Promise<void>;
      onEvent(callback: (sessionId: string, event: WireEvent) => void): () => void;
    };
  }
}
