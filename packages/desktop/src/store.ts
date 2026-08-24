import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { TurnMessage } from '@qodea/core';

export interface StoredSession {
  id: string;
  title: string;
  cwd: string | null;
  providerId?: string;
  model?: string;
  createdAt: number;
  updatedAt: number;
  messages: TurnMessage[];
}

const file = (): string => path.join(os.homedir(), '.qodea', 'sessions.json');

export async function listSessions(): Promise<StoredSession[]> {
  try {
    const raw = await fs.readFile(file(), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StoredSession[]) : [];
  } catch {
    return [];
  }
}

export async function getSession(id: string): Promise<StoredSession | null> {
  return (await listSessions()).find((s) => s.id === id) ?? null;
}

export async function saveSessions(list: StoredSession[]): Promise<void> {
  const dir = path.join(os.homedir(), '.qodea');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(file(), JSON.stringify(list, null, 2) + '\n', 'utf8');
}

/** Creates or touches a session record when a run starts. Returns its id. */
export async function touchSession(input: {
  id?: string;
  task: string;
  cwd?: string;
  providerId?: string;
  model?: string;
}): Promise<string> {
  const all = await listSessions();
  const now = Date.now();
  const id = input.id ?? `s_${now}_${Math.random().toString(36).slice(2, 8)}`;
  const existing = all.find((s) => s.id === id);

  if (existing) {
    existing.updatedAt = now;
    if (input.cwd) existing.cwd = input.cwd;
    if (input.providerId) existing.providerId = input.providerId;
    if (input.model) existing.model = input.model;
  } else {
    all.unshift({
      id,
      title: firstLine(input.task).slice(0, 70),
      cwd: input.cwd ?? null,
      ...(input.providerId ? { providerId: input.providerId } : {}),
      ...(input.model ? { model: input.model } : {}),
      createdAt: now,
      updatedAt: now,
      messages: [],
    });
  }

  await saveSessions(all);
  return id;
}

export async function appendMessages(id: string, messages: TurnMessage[]): Promise<void> {
  const all = await listSessions();
  const s = all.find((x) => x.id === id);
  if (!s) return;
  s.messages = messages;
  s.updatedAt = Date.now();
  // refresh title once real content lands (keeps list readable)
  const firstUser = messages.find((m) => m.role === 'user');
  if (firstUser && firstUser.content) {
    s.title = firstLine(firstUser.content).slice(0, 70) || s.title;
  }
  await saveSessions(all);
}

export async function deleteSession(id: string): Promise<void> {
  await saveSessions((await listSessions()).filter((s) => s.id !== id));
}

function firstLine(text: string): string {
  // strip the [cwd: …] prefix so titles stay clean
  const clean = text.trim().replace(/^\[cwd:[^\]]*\]\s*/, '');
  return clean.split(/\r?\n/)[0] ?? '';
}

/* ── projects ─────────────────────────────────────────────────────────────── */

export interface StoredProject {
  id: string;
  name: string;
  cwd: string;
  createdAt: number;
}

const projectsFile = (): string => path.join(os.homedir(), '.qodea', 'projects.json');

export async function listProjects(): Promise<StoredProject[]> {
  try {
    const raw = await fs.readFile(projectsFile(), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StoredProject[]) : [];
  } catch {
    return [];
  }
}

export async function saveProjects(list: StoredProject[]): Promise<void> {
  const dir = path.join(os.homedir(), '.qodea');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(projectsFile(), JSON.stringify(list, null, 2) + '\n', 'utf8');
}

export async function addProject(cwd: string): Promise<StoredProject> {
  const all = await listProjects();
  const norm = cwd.replace(/[\\/]+$/, '');
  const existing = all.find((p) => p.cwd.toLowerCase() === norm.toLowerCase());
  if (existing) return existing;

  const name = norm.split(/[\\/]/).pop() || norm;
  const project: StoredProject = {
    id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name,
    cwd: norm,
    createdAt: Date.now(),
  };
  all.push(project);
  await saveProjects(all);
  return project;
}

export async function deleteProject(id: string): Promise<void> {
  await saveProjects((await listProjects()).filter((p) => p.id !== id));
}
