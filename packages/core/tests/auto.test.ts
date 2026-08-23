import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  runAgentAuto,
  type AgentEvent,
  type ChatRequest,
  type StreamEvent,
} from '../src/index.js';
import { FakeProvider } from './fake-provider.js';

const dirs: string[] = [];
afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

async function workspace(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'qodea-auto-'));
  dirs.push(dir);
  return dir;
}

async function drive(
  gen: AsyncGenerator<AgentEvent | { type: string }, { reason: string }>,
): Promise<{ events: AgentEvent[]; reason: string }> {
  const events: AgentEvent[] = [];
  let reason = '';
  for (;;) {
    const n = await gen.next();
    if (n.done) {
      reason = (n.value as { reason: string }).reason;
      break;
    }
    events.push(n.value as AgentEvent);
  }
  return { events, reason };
}

const doneEv = (): StreamEvent[] => [
  { type: 'text-delta', text: '[DONE]' },
  { type: 'done', stopReason: 'end' },
];

describe('autonomous supervisor', () => {
  it('finishes immediately when the model outputs [DONE]', async () => {
    const cwd = await workspace();
    let calls = 0;
    const provider = new FakeProvider(() => {
      calls++;
      return doneEv();
    });

    const { events, reason } = await drive(
      runAgentAuto({
        provider,
        model: 'm',
        task: 'quick goal',
        cwd,
        mode: 'yolo',
        stallTimeoutMs: 1000,
      }),
    );

    expect(reason).toBe('complete');
    expect(calls).toBe(1);
    expect(events.some((e) => e.type === 'auto-restart')).toBe(false);
  });

  it('restarts after a provider error and completes on the next attempt', async () => {
    const cwd = await workspace();
    const provider = new FakeProvider((req, i) => {
      if (i === 0) throw new Error('boom — provider exploded');
      return doneEv();
    });

    const { events, reason } = await drive(
      runAgentAuto({
        provider,
        model: 'm',
        task: 'recover please',
        cwd,
        mode: 'yolo',
        maxRestarts: 5,
        restartBaseDelayMs: 10,
        stallTimeoutMs: 1000,
      }),
    );

    const restarts = events.filter((e) => e.type === 'auto-restart');
    expect(restarts.length).toBe(1);
    expect(reason).toBe('complete');
  });

  it('watchdog detects a stalled provider and restarts until limits', async () => {
    const cwd = await workspace();

    class HangingProvider extends FakeProvider {
      constructor() {
        super(() => []);
      }
      override async *streamChat(_req: ChatRequest): AsyncGenerator<StreamEvent, void, unknown> {
        // ignores the signal entirely — worst case scenario
        await new Promise((r) => setTimeout(r, 1200));
        yield { type: 'text-delta', text: 'late' };
        yield { type: 'done', stopReason: 'end' };
      }
    }

    const { reason } = await drive(
      runAgentAuto({
        provider: new HangingProvider(),
        model: 'm',
        task: 'hang forever',
        cwd,
        mode: 'yolo',
        stallTimeoutMs: 150,
        maxRestarts: 1,
        restartBaseDelayMs: 10,
      }),
    );

    expect(reason).toBe('failed'); // restart limit exhausted
  });

  it('stops immediately on user abort even mid-restart-backoff', async () => {
    const cwd = await workspace();
    const provider = new FakeProvider(() => {
      throw new Error('always broken');
    });

    const ac = new AbortController();
    setTimeout(() => ac.abort(), 60);

    const { reason } = await drive(
      runAgentAuto({
        provider,
        model: 'm',
        task: 'broken task',
        cwd,
        mode: 'yolo',
        maxRestarts: 99,
        restartBaseDelayMs: 5000, // long backoff — abort must cut through
        stallTimeoutMs: 1000,
        signal: ac.signal,
      }),
    );

    expect(reason).toBe('aborted');
  });
});
