import { emptyAgentState } from '../tools/types.js';
import { runAgent, type AgentEvent, type AgentRunOptions, type AgentRunResult } from './loop.js';
import { userMessage, type Provider } from '../types.js';
import type { TurnMessage } from '../types.js';
import { isAbortError } from './ref.js';

/** Supervisor: runs the agent loop for HOURS — restarts on errors,
 *  aborts on stalls (watchdog), keeps the transcript flowing between attempts.
 *  The run only truly ends when: the model outputs [DONE], the wall clock runs out,
 *  restart limits are hit, or the user aborts. */
function isAbortSignalAborted(signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted);
}


const ATTEMPT_MAX_TURNS = 25;

export interface AutoLoopOptions extends AgentRunOptions {
  /** Hard wall-clock limit (default 8 hours). */
  wallClockMs?: number;
  /** Event silence that counts as a stall (default 10 minutes). */
  stallTimeoutMs?: number;
  /** How many times a crashed/stalled attempt may be relaunched. */
  maxRestarts?: number;
  /** Base delay for exponential backoff between error-restarts. */
  restartBaseDelayMs?: number;
  /** Same mutable queue passed through to every attempt. */
  injectQueue?: { items: string[] };
  /**
   * Failover chain: on repeated failure the supervisor cycles through these
   * (provider, model) pairs. Index cycles, so the primary stays first.
   */
  failovers?: Array<{ provider: Provider; model: string }>;
  /** Stall timeout grows 50% per same-provider retry, capped here (default 30 min). */
  maxStallTimeoutMs?: number;
}

type NextRes = { done: boolean; value?: AgentEvent; err?: unknown; stalled?: boolean };

function nextWithTimeout(
  gen: AsyncGenerator<AgentEvent, AgentRunResult>,
  ms: number,
): Promise<NextRes> {
  return new Promise((resolve) => {
    let finished = false;
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      resolve({ done: false, stalled: true });
    }, ms);

    gen.next().then(
      (r) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve({ done: r.done ?? false, value: r.value as AgentEvent | undefined });
      },
      (e) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve({ done: true, err: e });
      },
    );
  });
}

class StallSignal extends Error {
  constructor() {
    super('watchdog: event silence');
    this.name = 'StallError';
  }
}

const ABORT_ERR = () => Object.assign(new Error('aborted by user'), { name: 'AbortError' });

export async function* runAgentAuto(
  opts: AutoLoopOptions,
): AsyncGenerator<AgentEvent | { type: 'auto-restart'; attempt: number; reason: string; delayMs: number }, AgentRunResult, unknown> {
  const wallClockMs = opts.wallClockMs ?? 8 * 3600_000;
  const stallTimeoutMs = opts.stallTimeoutMs ?? 600_000;
  const maxRestarts = opts.maxRestarts ?? 60;
  const restartBaseDelayMs = opts.restartBaseDelayMs ?? 1500;

  const startedAt = Date.now();
  let state = opts.state ?? emptyAgentState();
  let messages: TurnMessage[] = [...(opts.initialMessages ?? [])];

  const finish = (reason: AgentRunResult['reason'], turns: number): AgentRunResult => ({
    reason,
    turns,
    state,
    messages,
  });

  let restarts = 0;
  let attempt = 0;
  let failoverIndex = 0;
  let consecutiveErrors = 0;
  let lastErrorKey = '';
  let attemptStallMs = stallTimeoutMs; // grows 50% per same-provider concrete-error retry

  for (;;) {
    attempt_loop: {
      attempt++;
      const attemptAc = new AbortController();
      const deadlineTimer = setTimeout(() => attemptAc.abort(), Math.max(0, wallClockMs - (Date.now() - startedAt)));
      if (opts.signal?.aborted) attemptAc.abort();
      const onOuterAbort = () => attemptAc.abort();
      opts.signal?.addEventListener('abort', onOuterAbort, { once: true });

      try {
        // wall clock
        if (Date.now() - startedAt > wallClockMs) {
          yield { type: 'done', reason: 'time-limit', turns: attempt };
          return finish('time-limit', attempt);
        }

        // ── failover chain: cycle provider/model per attempt ──
        const chain = opts.failovers ?? [];
        const step = chain.length > 0 ? failoverIndex % (chain.length + 1) : 0;
        const useFailover = step > 0 && chain.length > 0;
        const stepCfg = useFailover ? chain[(step - 1) % chain.length] : undefined;

        const attemptOpts: AgentRunOptions = {
          provider: stepCfg ? stepCfg.provider : opts.provider,
          model: stepCfg ? stepCfg.model : opts.model,
          task: opts.task,
          images: opts.images,
          cwd: opts.cwd,
          mode: opts.mode ?? 'default',
          tools: opts.tools,
          state,
          onCheckpoint: (transcript, currentState) => { messages = transcript; state = currentState; },
          ...(opts.asker ? { asker: opts.asker } : {}),
          ...(opts.systemPrompt ? { systemPrompt: opts.systemPrompt } : {}),
          ...(opts.systemSuffix ? { systemSuffix: opts.systemSuffix } : {}),
          ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
          ...(opts.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}),
          ...(opts.reasoningEffort ? { reasoningEffort: opts.reasoningEffort } : {}),
          ...(opts.enableSubagents !== undefined
            ? { enableSubagents: opts.enableSubagents }
            : {}),
          ...(opts.maxParallelSpawns !== undefined
            ? { maxParallelSpawns: opts.maxParallelSpawns }
            : {}),
          ...(opts.agents ? { agents: opts.agents } : {}),
          signal: attemptAc.signal,
          maxTurns: opts.maxTurns ?? ATTEMPT_MAX_TURNS,
          ...(opts.injectQueue ? { injectQueue: opts.injectQueue } : {}),
          contextWindow: opts.contextWindow,
          ...(messages.length > 0
            ? { initialMessages: messages, skipTaskAppend: attempt > 1 || opts.skipTaskAppend }
            : {}),
        };

        const gen = runAgent(attemptOpts);
        let result: AgentRunResult | undefined;
        let lastActivity = Date.now();
        let pumpErr: unknown;
        let pumpedDone = false;

        // ── pump with watchdog ──
        while (!pumpedDone && !result) {
          if (attemptAc.signal.aborted || Date.now() - startedAt > wallClockMs) {
            throw StallOrAbort(attemptAc.signal.aborted);
          }
          const budget = Math.max(1, Math.min(attemptStallMs - (Date.now() - lastActivity), wallClockMs - (Date.now() - startedAt)));
          const res: NextRes = await nextWithTimeout(gen, budget);
          if (res.stalled) throw new StallSignal();
          if (res.err) {
            pumpErr = res.err;
            break;
          }
          if (res.done) {
            pumpedDone = true;
            result = res.value as unknown as AgentRunResult;
            break;
          }
          if (res.value) {
            lastActivity = Date.now();
            if (res.value.type !== 'done') yield res.value;
          }
        }
        void pumpErr; // non-abort stream errors are surfaced via result-less throw below

        if (!result) {
          // pump ended with an error
          throw pumpErr ?? new Error('stream ended unexpectedly');
        }

        // ── attempt finished cleanly ──
        messages = result.messages;
        state = result.state;
        consecutiveErrors = 0;
        attemptStallMs = stallTimeoutMs; // success resets the stall budget

        if (!opts.signal?.aborted && Date.now() - startedAt >= wallClockMs) {
          yield { type: 'done', reason: 'time-limit', turns: attempt };
          return finish('time-limit', attempt);
        }
        if (result.reason === 'aborted' || isAbortSignalAborted(opts.signal)) {
          yield { type: 'done', reason: 'aborted', turns: attempt };
          return finish('aborted', attempt);
        }

        const finalText =
          [...result.messages]
            .reverse()
            .find((m) => m.role === 'assistant' && m.content.trim())?.content ?? '';

        // queued user messages override a [DONE] — new work arrived
        if (opts.injectQueue && opts.injectQueue.items.length > 0) {
          for (const text of opts.injectQueue.items.splice(0)) {
            messages.push(userMessage(text));
          }
          yield {
            type: 'auto-note',
            text: `New user message received (${attempt}.) — continuing…`,
          };
          break attempt_loop;
        }

        if (result.reason === 'failed') throw new Error('stream ended unexpectedly or returned an empty response');

        if (result.reason === 'complete' && finalText.trim()) {
          yield { type: 'done', reason: 'complete', turns: attempt };
          return finish('complete', attempt);
        }

        // tools were used → real work may be ongoing: continue with transcript
        yield {
          type: 'auto-note',
          text: `Turn ${attempt} vége (${result.reason}) — goal not complete, continuing…`,
        };
        break attempt_loop;
      } catch (err) {
        attemptAc.abort();
        if (Date.now() - startedAt >= wallClockMs) {
          yield { type: 'done', reason: 'time-limit', turns: attempt };
          return finish('time-limit', attempt);
        }
        const aborted = isAbortSignalAborted(opts.signal) || isAbortError(err);
        opts.signal?.removeEventListener('abort', onOuterAbort);
        if (aborted) {
          yield { type: 'done', reason: 'aborted', turns: attempt };
          return finish('aborted', attempt);
        }

        // Complete interrupted tool batches before sending this transcript again.
        const answered = new Set(messages.filter((m) => m.role === 'tool_result').map((m) => m.callId));
        for (const message of [...messages]) {
          if (message.role !== 'assistant') continue;
          for (const call of message.toolCalls ?? []) {
            if (!answered.has(call.id)) {
              messages.push({ role: 'tool_result', callId: call.id, name: call.name,
                content: 'Execution interrupted. Inspect actual state before retrying; the action may have partially completed.', isError: true });
              answered.add(call.id);
            }
          }
        }
        const apiError = err as { status?: number; headers?: Headers | Record<string, string>; message?: string };
        const status = apiError?.status;
        const permanent = (status !== undefined && status >= 400 && status < 500 && ![408, 409, 429].includes(status)) ||
          /insufficient_quota|billing|credit balance|payment required/i.test(apiError?.message ?? '');
        if (permanent) {
          yield { type: 'auto-note', text: `Request cannot be retried: ${apiError.message ?? String(err)}` };
          yield { type: 'done', reason: 'failed', turns: attempt };
          return finish('failed', attempt);
        }
        failoverIndex++;
        restarts++;
        const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        const key = reason.slice(0, 160);
        if (key === lastErrorKey) consecutiveErrors++;
        else {
          consecutiveErrors = 1;
          lastErrorKey = key;
        }

        if (consecutiveErrors >= 3) {
          yield { type: 'done', reason: 'failed', turns: attempt };
          return finish('failed', attempt);
        }
        if (restarts > maxRestarts) {
          yield { type: 'done', reason: 'failed', turns: attempt };
          return finish('failed', attempt);
        }

        // Respect provider cooldowns and back off between retries.
        // Watchdog budget grows 50% per retry so slow providers get room.
        const isStall = /StallError|watchdog/i.test(reason);
        const delay = isStall
          ? Math.min(30_000, restartBaseDelayMs * 2 ** (restarts - 1))
          : Math.min(60_000, restartBaseDelayMs * 2 ** (restarts - 1));
        const retryAfter = apiError.headers instanceof Headers ? apiError.headers.get('retry-after') : apiError.headers?.['retry-after'];
        const retryMs = retryAfter ? (Number.isFinite(Number(retryAfter)) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now()) : 0;
        const waitMs = Math.min(Math.max(delay, Number.isFinite(retryMs) ? retryMs : 0), Math.max(0, wallClockMs - (Date.now() - startedAt)));
        attemptStallMs = Math.min(attemptStallMs * 1.5, opts.maxStallTimeoutMs ?? 1_800_000);

        yield { type: 'auto-restart', attempt, reason, delayMs: waitMs };
        await new Promise<void>((resolve) => {
          const onAbort = () => { clearTimeout(t); opts.signal?.removeEventListener('abort', onAbort); resolve(); };
          const t = setTimeout(() => { opts.signal?.removeEventListener('abort', onAbort); resolve(); }, waitMs);
          opts.signal?.addEventListener('abort', onAbort, { once: true });
          if (opts.signal?.aborted) onAbort();
        });
        if (isAbortSignalAborted(opts.signal)) {
          yield { type: 'done', reason: 'aborted', turns: attempt };
          return finish('aborted', attempt);
        }
        break attempt_loop; // relaunch
      } finally {
        clearTimeout(deadlineTimer);
        attemptAc.abort();
        opts.signal?.removeEventListener('abort', onOuterAbort);
      }
    }
  }
}

function StallOrAbort(wasUserAbort: boolean): Error {
  if (wasUserAbort) return ABORT_ERR();
  return new StallSignal();
}
