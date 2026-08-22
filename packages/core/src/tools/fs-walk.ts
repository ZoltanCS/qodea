import { promises as fs } from 'node:fs';
import path from 'node:path';

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'out',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '__pycache__',
  '.venv',
  'venv',
]);

export interface WalkOptions {
  root: string;
  /** Hard cap on returned files (safety valve). */
  maxFiles?: number;
}

/** Recursively lists text-project files under root, skipping junk directories. */
export async function walkProject(opts: WalkOptions): Promise<string[]> {
  const files: string[] = [];
  const max = opts.maxFiles ?? 5000;

  async function visit(dir: string): Promise<void> {
    if (files.length >= max) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable dir — ignore
    }
    for (const entry of entries) {
      if (files.length >= max) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || (entry.name.startsWith('.') && entry.name !== '.')) {
          continue;
        }
        await visit(full);
      } else if (entry.isFile()) {
        files.push(path.relative(opts.root, full).replaceAll('\\', '/'));
      }
    }
  }

  await visit(opts.root);
  return files;
}

/**
 * Minimal glob matcher: supports `*` (within a segment), `**` (across
 * segments), `?` (single char) and literal text. Enough for tool use.
 */
export function globToRegExp(pattern: string): RegExp {
  let re = '';
  const segments = pattern.split('/');
  segments.forEach((seg, i) => {
    const last = i === segments.length - 1;
    if (seg === '**') {
      re += last ? '.*' : '(?:[^/]+/)*';
      return;
    }
    for (let c = 0; c < seg.length; c++) {
      const ch: string | undefined = seg[c];
      if (ch === undefined) continue;
      if (ch === '*') re += '[^/]*';
      else if (ch === '?') re += '[^/]';
      else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
    if (!last) re += '/';
  });
  return new RegExp(`^${re}$`);
}
