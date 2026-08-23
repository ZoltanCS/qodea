/**
 * Dev runner — replaces `turbo run dev` because turbo does not reliably kill
 * child process trees on Windows when you press Ctrl+C ("shutting down..." forever).
 *
 * Spawns the Vite dev server and Electron directly; on SIGINT/SIGTERM it
 * taskkills each process tree (/T /F), so nothing lingers behind.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pnpmCjs = path.join(
  process.env.APPDATA ?? '',
  'npm',
  'node_modules',
  'pnpm',
  'bin',
  'pnpm.cjs',
);

const COLORS = { ui: '\x1b[36m', app: '\x1b[35m' };
const RESET = '\x1b[0m';

const procs = [];
let shuttingDown = false;

function launch(label, args) {
  const p = spawn(process.execPath, [pnpmCjs, ...args], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  procs.push(p);

  const tag = `${COLORS[label === 'ui' ? 'ui' : 'app']}[${label}]${RESET}`;
  const forward = (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (line.trim()) process.stdout.write(`${tag} ${line}\n`);
    }
  };
  p.stdout.on('data', forward);
  p.stderr.on('data', forward);
  p.on('exit', (code) => {
    if (!shuttingDown) process.stdout.write(`${tag} exited (${code})\n`);
  });
}

function killAll() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const p of procs) {
    if (!p.pid) continue;
    try {
      // Windows: kill the entire process tree
      spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      /* already gone */
    }
  }
}

launch('ui', ['--filter', '@qodea/ui', 'dev']);
launch('app', ['--filter', '@qodea/desktop', 'dev']);

process.on('SIGINT', () => {
  console.log('\n[qodea] leállítás…');
  killAll();
  setTimeout(() => process.exit(0), 600);
});
process.on('SIGTERM', () => {
  killAll();
  setTimeout(() => process.exit(0), 600);
});
process.on('exit', killAll);
