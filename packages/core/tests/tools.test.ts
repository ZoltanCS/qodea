import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  bashTool,
  createDefaultTools,
  editTool,
  emptyAgentState,
  globTool,
  grepTool,
  readTool,
  todoWriteTool,
  writeTool,
  type ToolContext,
} from '../src/index.js';

const dirs: string[] = [];

afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

let cwd: string;
let ctx: ToolContext;

beforeEach(async () => {
  cwd = await mkdtemp(path.join(tmpdir(), 'qodea-tools-'));
  dirs.push(cwd);
  ctx = { cwd, state: emptyAgentState() };
});

describe('file tools', () => {
  it('write → read round trip with numbered lines', async () => {
    const out = await writeTool.run({ path: 'greet.txt', content: 'one\ntwo' }, ctx);
    expect(out).toContain('greet.txt');

    const content = await readTool.run({ path: 'greet.txt' }, ctx);
    expect(content).toContain('     1\tone');
    expect(content).toContain('     2\ttwo');
    expect(await readFile(path.join(cwd, 'greet.txt'), 'utf8')).toBe('one\ntwo');
  });

  it('edit replaces a unique match and reports counts', async () => {
    await writeFile(path.join(cwd, 'code.js'), 'const a = 1;\nconst b = a + a;\n', 'utf8');

    const out = await editTool.run(
      { path: 'code.js', old_string: 'const b = a + a;', new_string: 'const b = a * 2;' },
      ctx,
    );
    expect(out).toContain('1 occurrence');
    expect(await readFile(path.join(cwd, 'code.js'), 'utf8')).toContain('a * 2');
  });

  it('edit refuses ambiguous matches unless replace_all', async () => {
    await writeFile(path.join(cwd, 'dup.txt'), 'x\nx\n', 'utf8');

    await expect(
      editTool.run({ path: 'dup.txt', old_string: 'x', new_string: 'y' }, ctx),
    ).rejects.toThrow(/2 times/);

    const out = await editTool.run(
      { path: 'dup.txt', old_string: 'x', new_string: 'y', replace_all: true },
      ctx,
    );
    expect(out).toContain('2 occurrences');
    expect(await readFile(path.join(cwd, 'dup.txt'), 'utf8')).toBe('y\ny\n');
  });

  it('edit fails clearly when the text is not found', async () => {
    await writeFile(path.join(cwd, 'f.txt'), 'real content', 'utf8');
    await expect(
      editTool.run({ path: 'f.txt', old_string: 'NOT THERE', new_string: '?' }, ctx),
    ).rejects.toThrow(/not found/);
  });
});

describe('search tools', () => {
  beforeEach(async () => {
    await writeFile(path.join(cwd, 'src.ts'), 'export const magic = 42;\n// TODO later\n', 'utf8');
    const sub = path.join(cwd, 'sub');
    await writeFile(path.join(sub, 'deep.ts').replace(sub, `${path.sep}sub`), 'nothing here', 'utf8').catch(
      async () => {
        const { mkdir } = await import('node:fs/promises');
        await mkdir(sub, { recursive: true });
        await writeFile(path.join(sub, 'deep.ts'), 'nothing here', 'utf8');
      },
    );
    await writeFile(path.join(cwd, 'notes.md'), '# notes\nmagic number is 42\n', 'utf8');
  });

  it('glob finds matching files but skips node_modules', async () => {
    await writeFile(path.join(cwd, 'node_modules', 'junk.ts'), 'x', 'utf8').catch(async () => {
      const { mkdir } = await import('node:fs/promises');
      await mkdir(path.join(cwd, 'node_modules'), { recursive: true });
      await writeFile(path.join(cwd, 'node_modules', 'junk.ts'), 'x', 'utf8');
    });

    const out = await globTool.run({ pattern: '**/*.ts' }, ctx);
    expect(out).toContain('src.ts');
    expect(out).toContain('sub/deep.ts');
    expect(out).not.toContain('junk.ts');
  });

  it('grep searches contents with include filter', async () => {
    const tsOnly = await grepTool.run({ pattern: 'magic', include: '*.ts' }, ctx);
    expect(tsOnly).toContain('src.ts:1:');
    expect(tsOnly).not.toContain('notes.md');

    const everywhere = await grepTool.run({ pattern: 'magic' }, ctx);
    expect(everywhere).toContain('notes.md');
  });

  it('glob returns a clear message when nothing matches', async () => {
    const out = await globTool.run({ pattern: '**/*.zig' }, ctx);
    expect(out).toMatch(/No files match/);
  });
});

describe('bash tool', () => {
  it('captures stdout and exit codes', async () => {
    const ok = await bashTool.run({ command: 'echo qodea-shell-test' }, ctx);
    expect(ok).toContain('[exit code: 0]');
    expect(ok).toContain('qodea-shell-test');

    const bad = await bashTool.run({ command: 'this-command-does-not-exist-98765' }, ctx);
    expect(bad).not.toMatch(/\[exit code: 0\]/);
  }, 30000);
});

describe('todo tool', () => {
  it('stores and renders the task list', async () => {
    const out = await todoWriteTool.run(
      {
        todos: [
          { content: 'plan', status: 'completed' },
          { content: 'build', status: 'in_progress' },
          { content: 'test', status: 'pending' },
        ],
      },
      ctx,
    );
    expect(out).toContain('(1/3 done)');
    expect(out).toContain('[x] plan');
    expect(out).toContain('[~] build');
    expect(ctx.state.todos).toHaveLength(3);
  });

  it('rejects invalid statuses', async () => {
    await expect(
      todoWriteTool.run({ todos: [{ content: 'x', status: 'done-ish' }] }, ctx),
    ).rejects.toThrow(/status/);
  });
});

describe('registry', () => {
  it('exposes the v1 toolset with specs', () => {
    const tools = createDefaultTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual([
      'read_file',
      'write_file',
      'edit_file',
      'glob_files',
      'grep_files',
      'bash',
      'todo_write',
      'web_search',
      'web_fetch',
      'browser_navigate',
      'browser_snapshot',
      'browser_click',
      'browser_type',
      'browser_scroll',
      'browser_screenshot',
      'browser_close',
    ]);

    for (const t of tools) {
      const spec = t.parametersJsonSchema as { type?: string; required?: string[] };
      expect(spec.type).toBe('object');
    }
  });
});
