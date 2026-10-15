# Qodea

An open-source, agentic coding app — multi-agent, skills, browser use, planning.
Built with TypeScript, Electron and a provider-agnostic agent core.

> Status: **M0 — scaffold & provider adapters.** Everything is in motion; see the roadmap below.

## Packages

| Package             | What it is                                                        |
| ------------------- | ----------------------------------------------------------------- |
| `packages/core`     | Agent runtime — providers, tools, permissions, sessions. Zero UI. |
| `packages/ui`       | React UI (chat, diffs, mascot, panels).                           |
| `packages/desktop`  | Electron shell (IPC bridge, node-pty, browser control).           |

## Providers (v1)

Anthropic · OpenAI · **Azure OpenAI** · Cerebras · OpenCode Zen · any OpenAI-compatible endpoint.

## Development

```bash
pnpm install
pnpm build          # build all packages
pnpm test           # run tests
pnpm typecheck      # strict TS check

# stream a live completion through any configured provider:
pnpm --filter @qodea/core smoke --provider azure --model gpt-4o-mini
pnpm --filter @qodea/core smoke --list
```

### Configuration

Qodea reads `~/.qodea/config.json`:

```jsonc
{
  "version": 1,
  "defaultProvider": "azure-main",
  "providers": [
    {
      "id": "azure-main",
      "kind": "azure",
      "label": "Azure OpenAI",
      "apiKeyEnv": "AZURE_OPENAI_API_KEY",
      "azure": {
        "endpoint": "https://YOUR-RESOURCE.openai.azure.com",
        "apiVersion": "2024-10-21"
      }
    },
    {
      "id": "zen",
      "kind": "zen",
      "defaultModel": "grok-code-fast-1"
    }
  ]
}
```

Without a config file, well-known env vars are auto-detected:
`AZURE_OPENAI_API_KEY` (+ `AZURE_OPENAI_ENDPOINT`), `OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, `CEREBRAS_API_KEY`, `OPENCODE_API_KEY`.

## Roadmap

- [x] **M0** — monorepo, config, provider adapters, live streaming
- [x] **M1** — agent loop + core tools (read/write/edit/glob/grep/bash/todo) + permission system
- [x] **M2** — Electron shell + chat UI + the mascot (white → red when debugging)
- [ ] **M3** — plan mode polish, todo panel visualization, sessions list
- [ ] **M4 = v1** — setup wizard, compaction, cost meter, NSIS installer
- [ ] **v1.5** — subagents with per-agent personas, skills (SKILL.md), browser use

## License

[MIT](./LICENSE)

### OpenCode Zen (Free)

In Settings → Providers, add the **OpenCode Zen (Free)** preset, fetch the
available models, choose one, enter your OpenCode API key, and save. The public
catalogue is refreshed on each fetch; only free Chat Completions models are
listed (including Big Pickle). Jev/System One and Muse/Responses models are
excluded because this adapter uses Chat Completions. An empty catalogue stays
empty rather than falling back to paid models. The provider rejects manually
entered paid model IDs. Free availability and rate limits are controlled by
OpenCode. API keys can also come from OPENCODE_API_KEY or ZEN_API_KEY.
