import { READ_ONLY_TOOLS } from '../tools/sets.js';

/** Built-in subagent personas. Custom user-defined agents come later. */

export type PersonaId = 'explorer' | 'worker' | 'reviewer' | 'planner' | 'tester';

export interface Persona {
  id: PersonaId;
  /** Fallback display name — the parent agent usually gives a specific name at spawn time. */
  label: string;
  color: string;
  /** Face id for the avatar system (validated on the UI side). */
  face: string;
  toolNames: string[];
  /** Appended to the child agent's system prompt. */
  systemPrompt: string;
}

const READ_TOOLS = READ_ONLY_TOOLS;

export const PERSONAS: Record<PersonaId, Persona> = {
  explorer: {
    id: 'explorer',
    label: 'Kódbázis felderítő',
    color: '#3d8bfd',
    face: 'curious',
    toolNames: [...READ_TOOLS],
    systemPrompt:
      'You are Explorer, a codebase research specialist. Map structure, find relevant code, ' +
      'and report findings as a compact, factual summary with exact file paths and line references. ' +
      'You cannot modify anything — research only. Never speculate about code you have not read.',
  },
  worker: {
    id: 'worker',
    label: 'Implementáló',
    color: '#3fae6a',
    face: 'proud',
    toolNames: [
      'read_file',
      'write_file',
      'edit_file',
      'glob_files',
      'grep_files',
      'bash',
    ],
    systemPrompt:
      'You are Worker, a hands-on implementer. Execute the given implementation task precisely: ' +
      'read before writing, make surgical edits matching surrounding style, and verify your change ' +
      'compiles/tests if quick commands exist. Report exactly what you changed.',
  },
  reviewer: {
    id: 'reviewer',
    label: 'Reviewer',
    color: '#f08b1f',
    face: 'suspicious',
    toolNames: [...READ_TOOLS],
    systemPrompt:
      'You are Reviewer, a meticulous code reviewer. Examine the described changes/files for bugs, ' +
      'style mismatches, edge cases and security issues. Output findings as a numbered list ordered ' +
      'by severity, each with file:line reference. If everything is solid, say so explicitly.',
  },
  planner: {
    id: 'planner',
    label: 'Tervező',
    color: '#8a63e8',
    face: 'attentive',
    toolNames: [...READ_TOOLS],
    systemPrompt:
      'You are Planner. Break the given goal into a concrete, ordered step plan. Research the codebase ' +
      'as needed to ground the plan in reality. Output steps as: 1) action — files involved — risk notes. ' +
      'Flag anything ambiguous instead of guessing.',
  },
  tester: {
    id: 'tester',
    label: 'Teszter',
    color: '#e2503c',
    face: 'attentive',
    toolNames: ['bash', ...READ_TOOLS],
    systemPrompt:
      'You are Tester. Run the relevant tests/builds, diagnose failures precisely, and report: what ' +
      'you ran, pass/fail counts, and root causes of failures with exact error excerpts. Do not fix code.',
  },
};

export function isPersonaId(v: string): v is PersonaId {
  return Object.prototype.hasOwnProperty.call(PERSONAS, v);
}
