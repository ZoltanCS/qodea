import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/** Lifetime usage aggregates — persisted at ~/.qodea/stats.json */

export interface ModelUsage {
  inTok: number;
  outTok: number;
  cachedTok: number;
  calls: number;
}

export interface UsageStatsFile {
  models: Record<string, ModelUsage>;
  updatedAt: number;
}

const file = (): string => path.join(os.homedir(), '.qodea', 'stats.json');

export function loadStats(): UsageStatsFile {
  try {
    const raw = fs.readFileSync(file(), 'utf8');
    const parsed = JSON.parse(raw) as UsageStatsFile;
    return parsed.models ? parsed : { models: {}, updatedAt: 0 };
  } catch {
    return { models: {}, updatedAt: 0 };
  }
}

export function saveStats(s: UsageStatsFile): void {
  const dir = path.join(os.homedir(), '.qodea');
  fs.mkdirSync(dir, { recursive: true });
  s.updatedAt = Date.now();
  fs.writeFileSync(file(), JSON.stringify(s, null, 2) + '\n', 'utf8');
}

export function addUsage(model: string, inTok: number, outTok: number, cachedTok: number): void {
  if (inTok <= 0 && outTok <= 0 && cachedTok <= 0) return;
  const s = loadStats();
  const m = s.models[model] ?? { inTok: 0, outTok: 0, cachedTok: 0, calls: 0 };
  m.inTok += inTok;
  m.outTok += outTok;
  m.cachedTok += cachedTok;
  m.calls += 1;
  s.models[model] = m;
  saveStats(s);
}
