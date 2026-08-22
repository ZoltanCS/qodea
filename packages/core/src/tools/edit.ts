import { promises as fs } from 'node:fs';
import path from 'node:path';
import { InvalidArgsError, type Tool } from './types.js';

interface EditArgs {
  path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

export const editTool: Tool = {
  name: 'edit_file',
  description:
    'Replace an exact string inside a file. The old_string must match exactly (including whitespace) and be unique — include surrounding lines for context, or set replace_all.',
  kind: 'write',
  parametersJsonSchema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      old_string: { type: 'string', description: 'Exact text to find.' },
      new_string: { type: 'string', description: 'Replacement text.' },
      replace_all: { type: 'boolean', description: 'Replace every occurrence (default false).' },
    },
    required: ['path', 'old_string', 'new_string'],
  },

  describe(args) {
    return `edit ${String(args['path'] ?? '?')}`;
  },

  async run(rawArgs, ctx) {
    const args = parseArgs(rawArgs);
    if (args.old_string === args.new_string) {
      throw new InvalidArgsError('old_string and new_string are identical');
    }

    const abs = path.resolve(ctx.cwd, args.path);
    let content: string;
    try {
      content = await fs.readFile(abs, 'utf8');
    } catch (err) {
      throw new Error(
        `Cannot read ${args.path}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const occurrences = content.split(args.old_string).length - 1;
    if (occurrences === 0) {
      throw new Error(
        `old_string not found in ${args.path}. Read the file first and copy the exact text (whitespace matters).`,
      );
    }
    if (occurrences > 1 && !args.replace_all) {
      throw new Error(
        `old_string matches ${occurrences} times in ${args.path}. Add surrounding lines to make it unique, or set replace_all=true.`,
      );
    }

    const updated = args.replace_all
      ? content.replaceAll(args.old_string, args.new_string)
      : content.replace(args.old_string, args.new_string);

    await fs.writeFile(abs, updated, 'utf8');
    const count = args.replace_all ? occurrences : 1;
    return `Edited ${args.path}: ${count} occurrence${count === 1 ? '' : 's'} replaced`;
  },
};

function parseArgs(raw: Record<string, unknown>): EditArgs {
  const p = raw['path'];
  const o = raw['old_string'];
  const n = raw['new_string'];
  if (typeof p !== 'string' || typeof o !== 'string' || typeof n !== 'string') {
    throw new InvalidArgsError('edit_file requires "path", "old_string", "new_string" strings');
  }
  return {
    path: p,
    old_string: o,
    new_string: n,
    replace_all: raw['replace_all'] === true,
  };
}
