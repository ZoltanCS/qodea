import { bashTool } from './bash.js';
import { editTool } from './edit.js';
import { globTool } from './glob.js';
import { grepTool } from './grep.js';
import { readTool } from './read.js';
import { todoWriteTool } from './todo-write.js';
import { writeTool } from './write.js';
import type { ToolSpec } from '../types.js';
import type { Tool } from './types.js';

/** The v1 core toolset — everything the agent can do to your project. */
export function createDefaultTools(): Tool[] {
  return [
    readTool,
    writeTool,
    editTool,
    globTool,
    grepTool,
    bashTool,
    todoWriteTool,
  ];
}

export function toSpec(tool: Tool): ToolSpec {
  return {
    name: tool.name,
    description: tool.description,
    parametersJsonSchema: tool.parametersJsonSchema,
  };
}
