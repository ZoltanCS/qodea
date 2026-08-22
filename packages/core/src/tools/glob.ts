import path from 'node:path';
import { globToRegExp, walkProject } from './fs-walk.js';
import { InvalidArgsError, type Tool } from './types.js';

export const globTool: Tool = {
  name: 'glob_files',
  description:
    'Find files by glob pattern (e.g. "src/**/*.ts", "*.json"). Skips node_modules, .git, build output. Returns up to 200 relative paths.',
  kind: 'read',
  parametersJsonSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern, e.g. "src/**/*.ts".' },
      path: { type: 'string', description: 'Directory to search from (default: working dir).' },
    },
    required: ['pattern'],
  },

  describe(args) {
    return `glob ${String(args['pattern'] ?? '?')}`;
  },

  async run(rawArgs, ctx) {
    const pattern = rawArgs['pattern'];
    if (typeof pattern !== 'string' || pattern.length === 0) {
      throw new InvalidArgsError('glob_files requires a "pattern" string');
    }
    const rootArg = typeof rawArgs['path'] === 'string' ? rawArgs['path'] : '.';
    const root = path.resolve(ctx.cwd, rootArg);

    const rx = globToRegExp(pattern);
    const files = await walkProject({ root });
    const hits = files.filter((f) => rx.test(f)).slice(0, 200);

    if (hits.length === 0) return `No files match "${pattern}"`;
    return `${hits.length} match(es):\n${hits.join('\n')}`;
  },
};
