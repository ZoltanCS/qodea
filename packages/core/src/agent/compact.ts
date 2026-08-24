import { estimateTokens } from '../util/tokens.js';
import type { TurnMessage } from '../types.js';

export interface CompactionPlan {
  should: boolean;
  /** messages[1..keepFrom) get summarized; [keepFrom..] stay raw */
  keepFrom: number;
  reason: string;
}

export interface CompactionConfig {
  ctxWindow: number;
  /** trigger at this fraction of the window (default 0.6) */
  triggerPct?: number;
  /** keep this many trailing messages raw (default 8) */
  keepTail?: number;
  /** don't fire again within this many turns */
  cooldownTurns?: number;
}

/**
 * Pure planner: decides if compaction should fire and where to cut.
 * Cheap-first: this only plans — the caller does tool-result clearing first
 * and only then an LLM summary if still above the trigger.
 */
export function planCompaction(
  messages: TurnMessage[],
  usedTokens: number,
  cfg: CompactionConfig & { turnsSinceLast?: number },
): CompactionPlan {
  const trigger = Math.round(cfg.ctxWindow * (cfg.triggerPct ?? 0.6));
  if (usedTokens < trigger) return { should: false, keepFrom: 0, reason: 'below trigger' };
  if ((cfg.turnsSinceLast ?? 999) < (cfg.cooldownTurns ?? 6))
    return { should: false, keepFrom: 0, reason: 'cooldown' };

  const keepTail = cfg.keepTail ?? 8;
  // never cut the system prompt (0) — slice within [1, len-keepTail]
  const keepFrom = Math.max(1, messages.length - keepTail);
  if (keepFrom <= 1) return { should: false, keepFrom: 0, reason: 'nothing to compact' };

  return { should: true, keepFrom, reason: `${usedTokens}/${cfg.ctxWindow} tokens` };
}

/** Builds the summary prompt for the middle slice — exact identifiers preserved. */
export function summaryPrompt(slice: TurnMessage[]): string {
  const lines: string[] = [
    'Summarize this agent transcript slice for continuity. Keep EXACTLY: the goal,',
    'decisions made, file paths, commands run + exit codes, errors, unfinished work.',
    'Do not add commentary. Max 300 words. Bullet list.',
    '', '--- TRANSCRIPT ---',
  ];
  for (const m of slice) {
    if (m.role === 'user') lines.push(`USER: ${m.content.slice(0, 400)}`);
    else if (m.role === 'assistant')
      lines.push(`ASSISTANT: ${m.content.slice(0, 300)}`);
    else if (m.role === 'tool_result')
      lines.push(`TOOL(${m.name}): ${m.content.slice(0, 150)}`);
  }
  return lines.join('\n');
}
