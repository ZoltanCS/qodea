#!/usr/bin/env node
/**
 * M0 smoke test: streams one chat completion to the terminal.
 *
 *   pnpm --filter @qodea/core smoke                          # default provider
 *   pnpm --filter @qodea/core smoke --provider azure
 *   pnpm --filter @qodea/core smoke --provider zen --model grok-code-fast-1
 *   pnpm --filter @qodea/core smoke --list
 */
import {
  createProvider,
  getEffectiveProviders,
  loadConfig,
  PROVIDER_PRESETS,
  resolveApiKey,
  type ProviderEntry,
} from '../index.js';

interface Args {
  provider?: string;
  model?: string;
  prompt?: string;
  list: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { list: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') args.list = true;
    else if (a === '--provider') args.provider = argv[++i];
    else if (a === '--model') args.model = argv[++i];
    else if (a === '--prompt') args.prompt = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.error('usage: smoke [--provider <id|kind>] [--model <name>] [--prompt <text>] [--list]');
      process.exit(0);
    }
  }
  return args;
}

const FALLBACK_MODELS: Record<string, string> = {
  azure: 'gpt-4o-mini',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-sonnet-4-5',
  cerebras: 'llama3.3-70b',
  zen: 'grok-code-fast-1',
};

function pickEntry(entries: ProviderEntry[], want?: string): ProviderEntry | undefined {
  if (!want) return entries[0];
  return (
    entries.find((e) => e.id === want) ??
    entries.find((e) => e.kind === want) ??
    entries.find((e) => e.label?.toLowerCase() === want.toLowerCase())
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = await loadConfig();
  const entries = getEffectiveProviders(config);

  if (args.list || entries.length === 0) {
    console.error('Available providers:');
    if (entries.length === 0) {
      console.error(
        '  (none detected)\n' +
          '  Set e.g. AZURE_OPENAI_API_KEY + AZURE_OPENAI_ENDPOINT, OPENAI_API_KEY,\n' +
          `  ANTHROPIC_API_KEY, CEREBRAS_API_KEY or OPENCODE_API_KEY — or create ${'~/.qodea/config.json'}`,
      );
      return;
    }
    for (const e of entries) {
      const preset = PROVIDER_PRESETS[e.kind];
      let keyState = 'inline';
      try {
        resolveApiKey(e);
      } catch {
        keyState = 'NO KEY';
      }
      console.error(`  - ${e.id.padEnd(16)} (${e.kind}) ${preset.label}${e.defaultModel ? ` · model: ${e.defaultModel}` : ''} [${keyState}]`);
    }
    return;
  }

  const entry = pickEntry(entries, args.provider);
  if (!entry) {
    throw new Error(`Provider not found: "${args.provider}". Try --list.`);
  }

  const provider = createProvider(entry);
  const model = args.model ?? entry.defaultModel ?? FALLBACK_MODELS[entry.kind] ?? 'gpt-4o-mini';
  const prompt =
    args.prompt ?? 'Answer in exactly two short sentences: what is the Node.js event loop?';

  console.error(`→ provider: ${provider.label} (${provider.kind}) · model: ${model}\n`);

  const startedAt = Date.now();
  let chars = 0;

  for await (const event of provider.streamChat({
    model,
    messages: [{ role: 'user', content: prompt }],
  })) {
    switch (event.type) {
      case 'text-delta': {
        chars += event.text.length;
        process.stdout.write(event.text);
        break;
      }
      case 'tool-call':
        console.error(`\n[tool-call] ${event.name}(${event.argumentsJson})`);
        break;
      case 'usage':
        console.error(
          `\n[usage] in=${event.inputTokens ?? '?'} out=${event.outputTokens ?? '?'}`,
        );
        break;
      case 'done':
        console.error(
          `\n\n✔ done (${event.stopReason}) · ${chars} chars · ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
        );
        break;
    }
  }
}

main().catch((err: unknown) => {
  console.error('\n✖ SMOKE FAILED:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
