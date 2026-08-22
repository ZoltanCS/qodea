import { promises as fs } from 'node:fs';
import path from 'node:path';
import { InvalidArgsError, type Tool } from './types.js';

export const writeTool: Tool = {
  name: 'write_file',
  description:
    'Create or overwrite a file with the given content. Parent directories are created automatically.',
  kind: 'write',
  parametersJsonSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path, relative to the working directory.' },
      content: { type: 'string', description: 'Full file content to write.' },
    },
    required: ['path', 'content'],
  },

  describe(args) {
    return `write ${String(args['path'] ?? '?')}`;
  },

  async run(rawArgs, ctx) {
    const p = rawArgs['path'];
    const content = rawArgs['content'];
    if (typeof p !== 'string' || p.length === 0 || typeof content !== 'string') {
      throw new InvalidArgsError('write_file requires "path" and "content" strings');
    }

    const abs = path.resolve(ctx.cwd, p);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, 'utf8');
    return `Wrote ${Buffer.byteLength(content, 'utf8')} bytes to ${p}`;
  },
};
