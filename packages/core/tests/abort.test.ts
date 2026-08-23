import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runAgent, type AgentEvent } from '../src/index.js';
import type { ChatRequest, StreamEvent } from '../src/index.js';
import { FakeProvider } from './fake-provider.js';

const dirs: string[] = [];
afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

async function workspace(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'qodea-abort-'));
  dirs.push(dir);
  return dir;
}

/** Provider whose stream rejects with AbortError the moment the signal fires. */
class HonoringProvider extends FakeProvider {
  constructor() {
    super(() => []);
  }
  override async *streamChat(req: ChatRequest): AsyncGenerator<StreamEvent, void, unknown> {
    yield { type: 'text-delta', text: 'par' };
    if (req.signal?.aborted) {
      throw Object.assign(new Error('Request was aborted.'), { name: 'AbortError' });
    }
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, 5000);
      req.signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        },
        { once: true },
      );
    });
  }
}

/** Stubborn provider that ignores the signal entirely and keeps calling tools. */
class StubbornProvider extends FakeProvider {
  constructor() {
    super(() => [
      { type: 'tool-call', id: `c${Math.random()}`, name: 'glob_files', argumentsJson: '{}' },
      { type: 'done', stopReason: 'tool-use' },
    ]);
  }
  override async *streamChat(req: ChatRequest): AsyncGenerator<StreamEvent, void, unknown> {
    void req.signal;
    // simulate real latency so the abort lands mid-run
    await new Promise((r) => setTimeout(r, 30));
    for (const ev of this.script(req, this.requests.length - 1)) yield ev;
  }
}

describe('agent abort', () => {
  it('returns gracefully when the provider stream throws AbortError', async () => {
    const cwd = await workspace();
    const provider = new HonoringProvider();

    const ac = new AbortController();
    const gen = runAgent({
      provider,
      model: 'm',
      task: 'long task',
      cwd,
      mode: 'yolo',
      signal: ac.signal,
    });

    setTimeout(() => ac.abort(), 120);
    const result = await drain(gen);
    expect(result.reason).toBe('aborted');
  });

  it('stops at the next boundary even if the provider ignores the signal', async () => {
    const cwd = await workspace();
    const provider = new StubbornProvider();

    const ac = new AbortController();
    setTimeout(() => ac.abort(), 150);

    const gen = runAgent({
      provider,
      model: 'm',
      task: 'loop',
      cwd,
      mode: 'yolo',
      maxTurns: 999,
      signal: ac.signal,
    });

    let doneReason = '';
    let returnedReason = '';
    for (;;) {
      const { value, done } = await gen.next();
      if (done) {
        returnedReason = (value as { reason: string }).reason;
        break;
      }
      if (value.type === 'done') doneReason = value.reason;
    }

    expect(doneReason).toBe('aborted');
    expect(returnedReason).toBe('aborted');
  });
});

async function drain(gen: AsyncGenerator<AgentEvent>): Promise<{ reason: string }> {
  let reason = '';
  for await (const ev of gen) {
    if (ev.type === 'done') reason = ev.reason;
  }
  return { reason };
}
