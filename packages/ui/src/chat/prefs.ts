import type { PermissionMode } from '@qodea/core';

export interface AgentPrefs {
  mode: PermissionMode;
  uiMode: 'agent' | 'experts';
  effort: 'low' | 'medium' | 'high';
}

const KEY = 'qodea-prefs';

const MODES: PermissionMode[] = ['read-only', 'default', 'yolo'];
const UIMODES = ['agent', 'experts'] as const;
const EFFORTS = ['low', 'medium', 'high'] as const;

export function loadPrefs(): Partial<AgentPrefs> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const p = JSON.parse(raw) as Partial<AgentPrefs>;
    const out: Partial<AgentPrefs> = {};
    if (MODES.includes(p.mode as PermissionMode)) out.mode = p.mode;
    if (UIMODES.includes(p.uiMode as (typeof UIMODES)[number]))
      out.uiMode = p.uiMode as (typeof UIMODES)[number];
    if (EFFORTS.includes(p.effort as (typeof EFFORTS)[number]))
      out.effort = p.effort as (typeof EFFORTS)[number];
    return out;
  } catch {
    return {};
  }
}

export function savePrefs(p: AgentPrefs): void {
  localStorage.setItem(KEY, JSON.stringify(p));
}
