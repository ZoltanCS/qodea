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
  sessionId?: string;
  task: string;
  providerId?: string;
  model?: string;
  mode: PermissionMode;
  cwd: string;
  reasoningEffort?: 'low' | 'medium' | 'high';
  history?: unknown[];
}

export interface ProviderDraft {
  id: string;
  kind: string;
  label: string | null;
  baseUrl: string | null;
  apiKeyEnv: string | null;
  defaultModel: string | null;
  contextWindow: number | null;
  azureEndpoint: string | null;
  azureApiVersion: string | null;
  azureDeployment: string | null;
  hasStoredKey: boolean;
}

export interface SaveDraft {
  id: string;
  kind: string;
  label?: string | null;
  baseUrl?: string | null;
  apiKeyEnv?: string | null;
  defaultModel?: string | null;
  contextWindow?: number | null;
  azureEndpoint?: string | null;
  azureApiVersion?: string | null;
  azureDeployment?: string | null;
  newApiKey?: string;
  clearStoredKey?: boolean;
}

export interface SessionSummary {
  id: string;
  title: string;
  cwd: string | null;
  updatedAt: number;
}

export interface StoredSession extends SessionSummary {
  messages: Array<Record<string, unknown>>;
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
      sessionsList(): Promise<SessionSummary[]>;
      sessionGet(id: string): Promise<StoredSession | null>;
      sessionDelete(id: string): Promise<void>;
      getConfig(): Promise<{
        defaultProvider: string | null;
        providers: ProviderDraft[];
      }>;
      saveConfig(payload: {
        defaultProvider: string | null;
        providers: SaveDraft[];
      }): Promise<{ savedTo: string }>;
      listModels(req: {
        id?: string;
        kind: string;
        baseUrl?: string;
        azureEndpoint?: string;
        newApiKey?: string;
      }): Promise<{ models: string[] }>;
      startSession(req: StartRequest): Promise<{ sessionId: string }>;
      respondPermission(sessionId: string, requestId: string, approved: boolean): Promise<void>;
      stopSession(sessionId: string): Promise<void>;
      onEvent(callback: (sessionId: string, event: WireEvent) => void): () => void;
    };
  }
}
