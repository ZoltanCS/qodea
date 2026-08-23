// ── types ────────────────────────────────────────────────────────────────────
export type {
  ChatMessage,
  ChatRequest,
  Provider,
  ProviderKind,
  Role,
  StopReason,
  StreamEvent,
  ToolCallReq,
  ToolSpec,
  TurnMessage,
  Usage,
} from './types.js';
export { providerKinds, userMessage } from './types.js';

// ── config ───────────────────────────────────────────────────────────────────
export {
  detectProvidersFromEnv,
  getEffectiveProviders,
  loadConfig,
  qodeaDir,
  resolveApiKey,
  configPath,
} from './config/loader.js';
export {
  configSchema,
  providerEntrySchema,
  type ProviderEntry,
  type QodeaConfig,
} from './config/schema.js';

// ── providers ────────────────────────────────────────────────────────────────
export { PROVIDER_PRESETS, type Preset } from './providers/presets.js';
export { createProvider } from './providers/factory.js';
export { OpenAICompatProvider } from './providers/openai-compat.js';
export { AzureProvider } from './providers/azure.js';
export { AnthropicProvider, toWireMessages as anthropicToWireMessages } from './providers/anthropic.js';
export { fetchAvailableModels } from './providers/models.js';

// ── tools ────────────────────────────────────────────────────────────────────
export { createDefaultTools, toSpec } from './tools/registry.js';
export type { AgentState, TodoItem, Tool, ToolContext, ToolKind } from './tools/types.js';
export { emptyAgentState, InvalidArgsError, ToolError } from './tools/types.js';
export { readTool } from './tools/read.js';
export { writeTool } from './tools/write.js';
export { editTool } from './tools/edit.js';
export { globTool } from './tools/glob.js';
export { grepTool } from './tools/grep.js';
export { bashTool } from './tools/bash.js';
export { webSearchTool, webFetchTool } from './tools/web.js';
export { createBrowserTools } from './tools/web-browser.js';
export { todoWriteTool, renderTodos } from './tools/todo-write.js';

// ── permissions ──────────────────────────────────────────────────────────────
export {
  PermissionManager,
  actionKey,
  type PermissionAsk,
  type PermissionAsker,
  type PermissionMode,
} from './permissions/manager.js';

export { createSpawnAgentTool } from './agents/spawn.js';
export { PERSONAS, isPersonaId, type Persona, type PersonaId } from './agents/personas.js';

// ── agent ────────────────────────────────────────────────────────────────────
export { runAgent, type AgentEvent, type AgentRunOptions, type AgentRunResult } from './agent/loop.js';
export { buildSystemPrompt, type PromptContext } from './agent/prompt.js';
