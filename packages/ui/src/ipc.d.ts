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

export interface ProjectInfo {
  id: string;
  name: string;
  cwd: string;
  createdAt: number;
}

export interface StartRequest {
  sessionId?: string;
  task: string;
  providerId?: string;
  model?: string;
  mode: PermissionMode;
  cwd: string;
  reasoningEffort?: 'low' | 'medium' | 'high';
  uiMode?: 'agent' | 'experts';
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
  fallbacks?: Array<{ provider: string; model: string }>;
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
  fallbacks?: Array<{ provider: string; model: string }>;
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

export interface AgentDef {
  id: string;
  name: string;
  color?: string;
  face?: string;
  tools?: string[];
  prompt?: string;
  model?: string;
  isBuiltin?: boolean;
}

export interface LifetimeStats {
  models: Record<string, { inTok: number; outTok: number; cachedTok: number; calls: number }>;
  updatedAt: number;
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
      projectsList(): Promise<ProjectInfo[]>;
      projectAdd(): Promise<ProjectInfo | null>;
      projectDelete(id: string): Promise<void>;
      statsGet(): Promise<LifetimeStats>;
      getConfig(): Promise<{
        defaultProvider: string | null;
        providers: ProviderDraft[];
        agents: AgentDef[];
      }>;
      saveConfig(payload: {
        defaultProvider: string | null;
        providers?: SaveDraft[];
        agents?: AgentDef[];
      }): Promise<{ savedTo: string }>;
      listModels(req: {
        id?: string;
        kind: string;
        baseUrl?: string;
        azureEndpoint?: string;
        newApiKey?: string;
      }): Promise<{ models: string[] }>;
      statsGet(): Promise<LifetimeStats>;
      getConfig(): Promise<{
        defaultProvider: string | null;
        providers: ProviderDraft[];
        agents: AgentDef[];
      }>;
      saveConfig(payload: {
        defaultProvider: string | null;
        providers?: SaveDraft[];
        agents?: AgentDef[];
      }): Promise<{ savedTo: string }>;
      startSession(req: StartRequest): Promise<{ sessionId: string }>;
      respondPermission(sessionId: string, requestId: string, approved: boolean): Promise<void>;
      stopSession(sessionId: string): Promise<void>;
      sendMessage(sessionId: string, text: string): Promise<{ queued: boolean }>;
      browserFrame(): Promise<string | null>;
      browserNavigate(url: string): Promise<string>;
      browserClick(xPct: number, yPct: number): Promise<void>;
      browserType(text: string): Promise<void>;
      browserKey(key: string): Promise<void>;
      brainstormOpen(): Promise<void>;
      brainstormMaterialize(sessionId: string): Promise<{ sessionId: string; task: string; cwd: string; history: unknown[] }>;
      closeBrainstormWindow(): Promise<void>;
      onEvent(callback: (sessionId: string, event: WireEvent) => void): () => void;
    };
  }
}
