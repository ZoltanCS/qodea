import { bashTool } from './bash.js';
import { editTool } from './edit.js';
import { globTool } from './glob.js';
import { grepTool } from './grep.js';
import { readTool } from './read.js';
import { todoWriteTool } from './todo-write.js';
import { webFetchTool, webSearchTool } from './web.js';
import { createBrowserTools } from './web-browser.js';
import { createBrowserPanelTools } from './browser/panel.js';
import { writeTool } from './write.js';
import type { ToolSpec } from '../types.js';
import type { Tool } from './types.js';

/** The v1 core toolset — everything the agent can do to your project and the web. */
export function createDefaultTools(): Tool[] {
  return [
    readTool,
    writeTool,
    editTool,
    globTool,
    grepTool,
    bashTool,
    todoWriteTool,
    webSearchTool,
    webFetchTool,
    ...createBrowserTools(),
    ...createBrowserPanelTools(),
  ];
}

export function toSpec(tool: Tool): ToolSpec {
  return {
    name: tool.name,
    description: tool.description,
    parametersJsonSchema: tool.parametersJsonSchema,
  };
}
