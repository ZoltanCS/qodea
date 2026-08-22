#!/usr/bin/env node
/**
 * Qodea headless agent runner.
 *
 *   pnpm --filter @qodea/core agent "add a README badge to package.json"
 *   pnpm --filter @qodea/core agent --provider azure --mode yolo "run the tests and fix failures"
 */
import { createInterface } from 'node:readline/promises';
import path from 'node:path';
import { stdin, stdout, stderr } from 'node:process';
import {
  createProvider,
  getEffectiveProviders,
  loadConfig,
  runAgent,
  type PermissionAsker,
  type ProviderEntry,
} from '../index.js';

interface Args {
  task?: string;
  provider?: string;
  model?: string;
  mode: 'read-only' | 'default' | 'yolo';
  cwd: string;
  maxTurns?: number;
  list: boolean;
}

const FALLBACK_MODELS: Record<string, string> = {
  azure: 'gpt-4o-mini',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-sonnet-4-5',
  cerebras: 'llama3.3-70b',
  zen: 'grok-code-fast-1',
};

function parseArgs(argv: string[]): Args {
  const args: Args = { mode: 'default', cwd: process.cwd(), list: false };
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--task' || a === '-t') args.task = argv[++i]!;
    else if (a === '--provider' || a === '-p') args.provider = argv[++i]!;
    else if (a === '--model' || a === '-m') args.model = argv[++i]!;
    else if (a === '--cwd') args.cwd = path.resolve(argv[++i]!);
    else if (a === '--max-turns') args.maxTurns = Number(argv[++i]);
    else if (a === '--yolo') args.mode = 'yolo';
    else if (a === '--read-only') args.mode = 'read-only';
    else if (a === '--list') args.list = true;
    else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else if (a !== undefined) positional.push(a);
  }
  if (!args.task && positional.length > 0) args.task = positional.join(' ');
  return args;
}

function printHelp(): void {
  stderr.write(
    [
      'usage: agent [options] "<task>"',
      '',
      'options:',
      '  -p, --provider <id|kind>   provider id or kind (see --list)',
      '  -m, --model <name>         model/deployment name',
      '      --cwd <dir>            working directory (default: current)',
      '      --mode <m>             read-only | default | yolo',
      '      --yolo                 full-auto shortcut',
      '      --max-turns <n>        safety cap on LLM turns (default 25)',
      '',
    ].join('\n'),
  );
}

function pickEntry(entries: ProviderEntry[], want?: string): ProviderEntry | undefined {
  if (!want) return entries[0];
  return entries.find((e) => e.id === want) ?? entries.find((e) => e.kind === want);
}

/** Terminal permission prompt: y = once ("igen" too), n = decline. */
function terminalAsker(): PermissionAsker {
  return async (ask) => {
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      stdout.write(`\n⚠ ${ask.tool}: ${ask.summary}\n   approve? [y/N] `);
      const answer = (await rl.question('')).trim().toLowerCase();
      return answer === 'y' || answer === 'igen';
    } finally {
      rl.close();
    }
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.task) {
    printHelp();
    throw new Error('no task given');
  }

  const config = await loadConfig();
  const entries = getEffectiveProviders(config);
  if (entries.length === 0) {
    throw new Error(
      'No providers configured. Set AZURE_OPENAI_API_KEY + AZURE_OPENAI_ENDPOINT, OPENAI_API_KEY, ANTHROPIC_API_KEY, CEREBRAS_API_KEY or OPENCODE_API_KEY.',
    );
  }

  const entry = pickEntry(entries, args.provider);
  if (!entry) throw new Error(`Provider not found: "${args.provider}"`);

  const provider = createProvider(entry);
  const model = args.model ?? entry.defaultModel ?? FALLBACK_MODELS[entry.kind] ?? 'gpt-4o-mini';

  stderr.write(
    `→ ${provider.label} (${entry.kind}) · model: ${model} · mode: ${args.mode} · cwd: ${args.cwd}\n\n`,
  );

  let turn = 0;
  let doneReason: string | undefined;

  for await (const ev of runAgent({
    provider,
    model,
    task: args.task,
    cwd: args.cwd,
    mode: args.mode,
    asker: args.mode === 'default' ? terminalAsker() : undefined,
    maxTurns: args.maxTurns,
  })) {
    switch (ev.type) {
      case 'turn-start':
        turn = ev.turn;
        break;
      case 'text-delta':
        stdout.write(ev.text);
        break;
      case 'tool-start':
        stderr.write(`\n⚙ [${ev.name}] ${ev.summary}\n`);
        break;
      case 'tool-result': {
        const preview = ev.content.length > 400 ? `${ev.content.slice(0, 400)}…` : ev.content;
        stderr.write(`${ev.isError ? '✖' : '✔'} ${preview.replaceAll('\n', '\n  ')}\n`);
        break;
      }
      case 'permission-denied':
        stderr.write(`⛔ permission denied: [${ev.name}] ${ev.summary}\n`);
        break;
      case 'done':
        doneReason = ev.reason;
        break;
      default:
        break;
    }
  }

  const ok = doneReason === 'complete';
  stderr.write(
    `\n\n${ok ? '✔' : '⚠'} agent finished (${doneReason}) after ${turn} turn(s)\n`,
  );
  if (!ok) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error('\n✖ AGENT FAILED:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
