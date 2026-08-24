import { promises as fs } from 'node:fs';
import path from 'node:path';
import { InvalidArgsError, type Tool } from './types.js';

const MAX_LINES = 400;
const MAX_CHARS = 24_000;

interface ReadArgs {
  path: string;
  offset?: number;
  limit?: number;
}

export const readTool: Tool = {
  name: 'read_file',
  description:
    'Read a text file. Returns numbered lines. Large files are truncated — use offset/limit to page through.',
  kind: 'read',
  parametersJsonSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path, relative to the working directory.' },
      offset: { type: 'number', description: '1-based line to start from (default 1).' },
      limit: { type: 'number', description: `Max lines to return (default ${MAX_LINES}).` },
    },
    required: ['path'],
  },

  describe(args) {
    return `read ${String(args['path'] ?? '?')}`;
  },

  async run(rawArgs, ctx) {
    const args = parseArgs(rawArgs);
    const abs = path.resolve(ctx.cwd, args.path);

    let content: string;
    try {
      content = await fs.readFile(abs, 'utf8');
    } catch (err) {
      throw new Error(
        `Cannot read ${args.path}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const allLines = content.split(/\r?\n/);
    const start = Math.max(0, (args.offset ?? 1) - 1);
    const end = Math.min(allLines.length, start + (args.limit ?? MAX_LINES));

    let out = '';
    for (let i = start; i < end; i++) {
      out += `${String(i + 1).padStart(6)}\t${allLines[i]}\n`;
      if (out.length > MAX_CHARS) {
        out += `\n[... truncated at ~${MAX_CHARS} chars — re-read with offset/limit]\n`;
        break;
      }
    }

    const header =
      start > 0 || end < allLines.length
        ? `[${path.basename(abs)} · lines ${start + 1}–${end} of ${allLines.length}]\n`
        : '';
    return header + out;
  },
};

function parseArgs(raw: Record<string, unknown>): ReadArgs {
  const p = raw['path'];
  if (typeof p !== 'string' || p.length === 0) {
    throw new InvalidArgsError('read_file requires a "path" string');
  }
  return {
    path: p,
    offset: typeof raw['offset'] === 'number' ? raw['offset'] : undefined,
    limit: typeof raw['limit'] === 'number' ? raw['limit'] : undefined,
  };
}
