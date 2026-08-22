import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  runAgent,
  type AgentEvent,
  type PermissionAsker,
} from '../src/index.js';
import { FakeProvider, callTool, text } from './fake-provider.js';

const dirs: string[] = [];

afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

async function makeWorkspace(file = 'note.txt', content = 'hello world'): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'qodea-agent-'));
  dirs.push(dir);
  const { writeFile, mkdir } = await import('node:fs/promises');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, file), content, 'utf8');
  return dir;
}

async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const ev of gen) events.push(ev);
  return events;
}

describe('agent loop', () => {
  it('executes a tool call and feeds the result back to the model', async () => {
    const cwd = await makeWorkspace();
    let sawToolResult = false;

    const provider = new FakeProvider((req, callIndex) => {
      if (callIndex === 0) return callTool('call_1', 'read_file', { path: 'note.txt' });

      const toolResults = req.messages.filter((m) => m.role === 'tool_result');
      expect(toolResults).toHaveLength(1);
      sawToolResult =
        (toolResults[0]?.content.includes('hello world') ?? false) &&
        toolResults[0]?.name === 'read_file';
      return text('The note says hello.');
    });

    const events = await collect(
      runAgent({
        provider,
        model: 'test-model',
        task: 'read the note',
        cwd,
        mode: 'yolo',
      }),
    );

    expect(sawToolResult).toBe(true);
    expect(events.some((e) => e.type === 'tool-start' && e.name === 'read_file')).toBe(true);
    expect(events.filter((e) => e.type === 'done')).toEqual([
      { type: 'done', reason: 'complete', turns: 2 },
    ]);
  });

  it('asks for permission in default mode and remembers the approval', async () => {
    const cwd = await makeWorkspace();

    const asks: string[] = [];
    const asker: PermissionAsker = vi.fn(async (ask) => {
      asks.push(`${ask.tool}: ${ask.summary}`);
      return true;
    });

    // two write calls with different files → same action key ("write_file") → asked once
    const provider = new FakeProvider((req, i) =>
      i === 0
        ? [
            ...callTool('c1', 'write_file', { path: 'a.txt', content: 'A' }),
            ...callTool('c2', 'write_file', { path: 'b.txt', content: 'B' }),
          ]
        : text('done writing'),
    );

    await collect(
      runAgent({ provider, model: 'm', task: 'write files', cwd, mode: 'default', asker }),
    );

    expect(asker).toHaveBeenCalledTimes(1);
    expect(asks[0]).toContain('a.txt');
    expect(await readFile(path.join(cwd, 'b.txt'), 'utf8')).toBe('B');
  });

  it('does not execute a denied tool', async () => {
    const cwd = await makeWorkspace();
    const asker: PermissionAsker = async () => false;

    const provider = new FakeProvider((req, i) => {
      if (i === 0) return callTool('c1', 'write_file', { path: 'evil.txt', content: 'nope' });
      const denied = req.messages.find((m) => m.role === 'tool_result');
      expect(denied?.isError).toBe(true);
      expect(denied?.content).toContain('Permission denied');
      return text('understood, not writing');
    });

    const events = await collect(
      runAgent({ provider, model: 'm', task: 'try to write', cwd, mode: 'default', asker }),
    );

    await expect(readFile(path.join(cwd, 'evil.txt'), 'utf8')).rejects.toThrow();
    expect(events.some((e) => e.type === 'permission-denied')).toBe(true);
  });

  it('blocks writes outright in read-only mode without asking', async () => {
    const cwd = await makeWorkspace();
    const asker = vi.fn(async (): Promise<boolean> => true);

    const provider = new FakeProvider((req, i) => {
      if (i === 0) return callTool('c1', 'write_file', { path: 'x.txt', content: 'x' });
      const denied = req.messages.find((m) => m.role === 'tool_result');
      expect(denied?.content).toContain('read-only');
      return text('ok, staying read-only');
    });

    await collect(
      runAgent({ provider, model: 'm', task: 'write?', cwd, mode: 'read-only', asker }),
    );
    expect(asker).not.toHaveBeenCalled();
  });

  it('never asks in yolo mode', async () => {
    const cwd = await makeWorkspace();
    const asker = vi.fn(async (): Promise<boolean> => {
      throw new Error('yolo must not ask');
    });

    const provider = new FakeProvider((req, i) =>
      i === 0 ? callTool('c1', 'bash', { command: 'echo yolo-test' }) : text('ran it'),
    );

    const events = await collect(
      runAgent({ provider, model: 'm', task: 'echo something', cwd, mode: 'yolo', asker }),
    );

    const result = events.find(
      (e): e is Extract<AgentEvent, { type: 'tool-result' }> =>
        e.type === 'tool-result' && e.name === 'bash',
    );
    expect(result?.isError).toBe(false);
    expect(result?.content).toContain('yolo-test');
  });

  it('stops at maxTurns even if the model keeps calling tools', async () => {
    const cwd = await makeWorkspace();
    const provider = new FakeProvider(() => callTool(`c${Math.random()}`, 'glob_files', {}));

    const events = await collect(
      runAgent({ provider, model: 'm', task: 'loop forever', cwd, mode: 'yolo', maxTurns: 3 }),
    );

    expect(events.filter((e) => e.type === 'done')).toEqual([
      { type: 'done', reason: 'max-turns', turns: 3 },
    ]);
  });

  it('reports unknown tools back as errors', async () => {
    const cwd = await makeWorkspace();
    const provider = new FakeProvider((req, i) => {
      if (i === 0) return callTool('c1', 'make_coffee', {});
      const err = req.messages.find((m) => m.role === 'tool_result');
      expect(err?.content).toContain('Unknown tool "make_coffee"');
      return text('sorry');
    });

    const events = await collect(
      runAgent({ provider, model: 'm', task: 'coffee please', cwd, mode: 'yolo' }),
    );

    const fail = events.find(
      (e): e is Extract<AgentEvent, { type: 'tool-result' }> =>
        e.type === 'tool-result' && e.isError,
    );
    expect(fail?.name).toBe('make_coffee');
  });
});
