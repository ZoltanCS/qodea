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

const DONE_RE = /\[DONE\]/i;
const ATTEMPT_MAX_TURNS = 25;
const ABORT_GRACE_MS = 400;

export interface AutoLoopOptions extends Omit<AgentRunOptions, 'initialMessages'> {
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

interface AttemptOutcome {
  result: AgentRunResult;
  error?: unknown;
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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
  const state = emptyAgentState();
  let messages: TurnMessage[] = [];

  const finish = (reason: AgentRunResult['reason'], turns: number): AgentRunResult => ({
    reason,
    turns,
    state,
    messages,
  });

  let restarts = 0;
  let attempt = 0;
  let consecutiveErrors = 0;
  let lastErrorKey = '';
  let attemptStallMs = stallTimeoutMs; // grows 50% per same-provider concrete-error retry
  let regenCount = 0; // empty/invalid response regenerations since last success

  for (;;) {
    attempt_loop: {
      attempt++;
      const attemptAc = new AbortController();
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
        const step = chain.length > 0 ? (attempt - 1) % (chain.length + 1) : 0;
        const useFailover = step > 0 && chain.length > 0;
        const stepCfg = useFailover ? chain[(step - 1) % chain.length] : undefined;

        const attemptOpts: AgentRunOptions = {
          provider: stepCfg ? stepCfg.provider : opts.provider,
          model: stepCfg ? stepCfg.model : opts.model,
          task: opts.task,
          cwd: opts.cwd,
          mode: opts.mode ?? 'yolo',
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
          maxTurns: ATTEMPT_MAX_TURNS,
          ...(opts.injectQueue ? { injectQueue: opts.injectQueue } : {}),
          contextWindow: opts.contextWindow,
          ...(messages.length > 0
            ? { initialMessages: messages, skipTaskAppend: true }
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
          const budget = Math.max(250, attemptStallMs - (Date.now() - lastActivity));
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
            yield res.value;
          }
        }
        void pumpErr; // non-abort stream errors are surfaced via result-less throw below

        if (!result) {
          // pump ended with an error
          throw pumpErr ?? new Error('stream ended unexpectedly');
        }

        // ── attempt finished cleanly ──
        messages = result.messages;
        consecutiveErrors = 0;
        attemptStallMs = stallTimeoutMs; // success resets the stall budget

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

        // ── empty/invalid response: regenerate the last answer once, then failover ──
        const isEmptyResponse =
          result.reason === 'complete' &&
          !finalText.trim() &&
          !result.messages.some((m) => m.role === 'tool_result');
        if (isEmptyResponse && regenCount < 1) {
          regenCount++;
          // drop the empty assistant tail so the retry generates fresh
          messages = messages.filter(
            (m, i) => !(i === messages.length - 1 && m.role === 'assistant'),
          );
          yield {
            type: 'auto-note',
            text: 'empty response — regenerating last answer…',
          };
          break attempt_loop; // immediate retry, no restart-count
        }

        if (DONE_RE.test(finalText)) {
          yield { type: 'done', reason: 'complete', turns: attempt };
          return finish('complete', attempt);
        }

        // ── anti-infinite-loop guard ──
        // If the model finished WITHOUT using any tool and without the [DONE]
        // marker, this was conversation / a plain answer — not an unfinished
        // goal. Continuing would re-generate the same answer forever.
        const usedTools = result.messages.some((m) => m.role === 'tool_result');
        if (!usedTools) {
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
        const aborted = isAbortError(err) || attemptAc.signal.aborted || isAbortSignalAborted(opts.signal);
        opts.signal?.removeEventListener('abort', onOuterAbort);
        if (aborted) {
          yield { type: 'done', reason: 'aborted', turns: attempt };
          return finish('aborted', attempt);
        }

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

        // concrete error → fixed 5s retry; stall → exponential backoff.
        // Watchdog budget grows 50% per retry so slow providers get room.
        const isStall = /StallError|watchdog/i.test(reason);
        const delay = isStall
          ? Math.min(30_000, restartBaseDelayMs * 2 ** (restarts - 1))
          : 5_000;
        attemptStallMs = Math.min(attemptStallMs * 1.5, 1_800_000);

        yield { type: 'auto-restart', attempt, reason, delayMs: delay };
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, delay);
          opts.signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(t);
              resolve();
            },
            { once: true },
          );
        });
        if (isAbortSignalAborted(opts.signal)) {
          yield { type: 'done', reason: 'aborted', turns: attempt };
          return finish('aborted', attempt);
        }
        break attempt_loop; // relaunch
      } finally {
        opts.signal?.removeEventListener('abort', onOuterAbort);
      }
    }
  }
}

function StallOrAbort(wasUserAbort: boolean): Error {
  if (wasUserAbort) return ABORT_ERR();
  return new StallSignal();
}
