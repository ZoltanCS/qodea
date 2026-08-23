import { spawn } from 'node:child_process';
import { InvalidArgsError, type Tool } from './types.js';

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;
const MAX_OUTPUT_CHARS = 10_000;

interface BashResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export const bashTool: Tool = {
  name: 'bash',
  description:
    'Run a shell command in the working directory (PowerShell on Windows, bash elsewhere) and return stdout/stderr/exit code. Prefer non-interactive commands.',
  kind: 'write',
  parametersJsonSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command to run.' },
      timeout_ms: {
        type: 'number',
        description: `Timeout in ms (default ${DEFAULT_TIMEOUT_MS}, max ${MAX_TIMEOUT_MS}).`,
      },
      background: {
        type: 'boolean',
        description:
          'Start without waiting for exit (dev servers, watchers, anything long-running). Returns immediately with the PID.',
      },
    },
    required: ['command'],
  },

  describe(args) {
    const cmd = String(args['command'] ?? '?');
    const bg = args['background'] === true ? ' (hátérben)' : '';
    return `futtatja: ${cmd.length > 60 ? `${cmd.slice(0, 60)}…` : cmd}${bg}`;
  },

  async run(rawArgs, ctx) {
    const command = rawArgs['command'];
    if (typeof command !== 'string' || command.trim().length === 0) {
      throw new InvalidArgsError('bash requires a "command" string');
    }

    // Long-running commands (servers, watchers) must go to the background,
    // otherwise the tool would block until timeout.
    const looksLikeServer =
      /\b(serve|serve\.|http-server|vite|next\s+(dev|start)|npm\s+run\s+dev|start|live-server|python\s+-m\s*http)\b/i.test(
        command,
      );

    if (rawArgs['background'] === true || (looksLikeServer && rawArgs['background'] !== false)) {
      return startBackground(command, ctx.cwd);
    }

    const timeout = clampTimeout(rawArgs['timeout_ms']);
    const result = await exec(command, ctx.cwd, timeout, ctx.signal);

    const parts: string[] = [];
    if (result.timedOut) {
      parts.push(`[timed out after ${Math.round(timeout / 1000)}s — killed]`);
      parts.push('[hint: szerver/figyelőkhoz használd background: true]');
    } else {
      parts.push(`[exit code: ${result.code ?? 'killed'}]`);
    }
    if (result.stdout) parts.push(`--- stdout ---\n${cap(result.stdout)}`);
    if (result.stderr) parts.push(`--- stderr ---\n${cap(result.stderr)}`);
    if (!result.stdout && !result.stderr && result.code === 0) parts.push('(no output)');
    return parts.join('\n');
  },
};

function startBackground(command: string, cwd: string): string {
  const isWin = process.platform === 'win32';
  const child = isWin
    ? spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
        cwd,
        detached: false,
        stdio: 'ignore',
        env: { ...process.env, npm_config_yes: 'true' },
      })
    : spawn(process.env['SHELL'] ?? '/bin/bash', ['-c', command], {
        cwd,
        detached: false,
        stdio: 'ignore',
        env: { ...process.env, npm_config_yes: 'true' },
      });
  const pid = child.pid ?? '?';
  child.unref();
  return [
    '[háttérben indítva]',
    `PID: ${pid}`,
    'A parancs fut — nem várunk rá. Ha kiszolgáló, ellenőrizd a portot/URL-t egy külön gyors paranccsal.',
  ].join('\n');
}

function exec(
  command: string,
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<BashResult> {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const child = isWin
      ? spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
          cwd,
          env: { ...process.env, npm_config_yes: 'true' },
        })
      : spawn(process.env['SHELL'] ?? '/bin/bash', ['-c', command], {
          cwd,
          env: { ...process.env, npm_config_yes: 'true' },
        });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      // Windows SIGTERM is unreliable for trees — escalate shortly after.
      setTimeout(() => {
        if (!settled && child.pid) {
          try {
            child.kill('SIGKILL');
          } catch {
            /* already dead */
          }
        }
      }, 1500);
    }, timeoutMs);

    const onAbort = () => {
      timedOut = true; // report as killed
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (stdout.length < MAX_OUTPUT_CHARS * 2) stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < MAX_OUTPUT_CHARS * 2) stderr += chunk;
    });

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve({ code, stdout, stderr, timedOut });
    };

    child.on('close', finish);
    child.on('error', (err) => {
      stderr += `\n[spawn error] ${err.message}`;
      finish(null);
    });
  });
}

function cap(text: string): string {
  return text.length > MAX_OUTPUT_CHARS
    ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n[... truncated]`
    : text;
}

function clampTimeout(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(1000, value), MAX_TIMEOUT_MS);
}
