import { promises as fs } from 'node:fs';
import path from 'node:path';
import { globToRegExp, walkProject } from './fs-walk.js';
import { InvalidArgsError, type Tool } from './types.js';

const MAX_FILE_BYTES = 1024 * 1024;
const DEFAULT_MAX_RESULTS = 100;

interface GrepArgs {
  pattern: string;
  path?: string;
  include?: string;
  max_results?: number;
}

export const grepTool: Tool = {
  name: 'grep_files',
  description:
    'Search file contents with a regular expression. Returns "file:line: text" matches. Use include (e.g. "*.ts") to filter by filename.',
  kind: 'read',
  parametersJsonSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regular expression (JS syntax).' },
      path: { type: 'string', description: 'File or directory to search (default: working dir).' },
      include: { type: 'string', description: 'Filename glob, e.g. "*.ts".' },
      max_results: { type: 'number', description: `Max matches (default ${DEFAULT_MAX_RESULTS}).` },
    },
    required: ['pattern'],
  },

  describe(args) {
    return `grep /${String(args['pattern'] ?? '?')}/`;
  },

  async run(rawArgs, ctx) {
    const args = parseArgs(rawArgs);
    let regex: RegExp;
    try {
      regex = new RegExp(args.pattern);
    } catch (err) {
      throw new InvalidArgsError(
        `Invalid regex: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const root = path.resolve(ctx.cwd, args.path ?? '.');
    const includeRe = args.include ? globToRegExp(path.basename(args.include)) : undefined;

    // single-file mode
    const stat = await fs.stat(root).catch(() => undefined);
    if (stat?.isFile()) {
      return searchFile(root, root, regex, args.max_results ?? DEFAULT_MAX_RESULTS);
    }

    const files = await walkProject({ root });
    const lines: string[] = [];
    const cap = args.max_results ?? DEFAULT_MAX_RESULTS;

    for (const rel of files) {
      if (lines.length >= cap) break;
      if (includeRe && !includeRe.test(rel.split('/').pop() ?? '')) continue;
      const abs = path.join(root, rel);
      const found = await searchFile(abs, rel, regex, cap - lines.length).catch(() => '');
      if (found) lines.push(found);
    }

    if (lines.length === 0) return `No matches for /${args.pattern}/`;
    return lines.join('\n');
  },
};

async function searchFile(
  abs: string,
  displayPath: string,
  regex: RegExp,
  cap: number,
): Promise<string> {
  let content: string;
  try {
    const stat = await fs.stat(abs);
    if (stat.size > MAX_FILE_BYTES) return '';
    content = await fs.readFile(abs, 'utf8');
  } catch {
    return '';
  }
  if (content.includes('\0')) return ''; // binary

  const out: string[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length && out.length < cap; i++) {
    const line: string | undefined = lines[i];
    if (line === undefined) break;
    if (regex.test(line)) {
      const trimmed = line.length > 240 ? `${line.slice(0, 240)}…` : line;
      out.push(`${displayPath}:${i + 1}: ${trimmed}`);
    }
  }
  return out.join('\n');
}

function parseArgs(raw: Record<string, unknown>): GrepArgs {
  const p = raw['pattern'];
  if (typeof p !== 'string' || p.length === 0) {
    throw new InvalidArgsError('grep_files requires a "pattern" string');
  }
  return {
    pattern: p,
    path: typeof raw['path'] === 'string' ? raw['path'] : undefined,
    include: typeof raw['include'] === 'string' ? raw['include'] : undefined,
    max_results: typeof raw['max_results'] === 'number' ? raw['max_results'] : undefined,
  };
}
