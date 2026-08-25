import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createProvider,
  fetchAvailableModels,
  getEffectiveProviders,
  loadConfig,
  PROVIDER_PRESETS,
  runAgentAuto,
  mergeAgents,
  createGenerateImageTool,
  resolveApiKey,
  type Tool,
  configSchema,
  type AgentEvent,
  type AgentRunOptions,
  type PermissionMode,
  type ProviderEntry,
  type TurnMessage,
} from '@qodea/core';
import { promises as fs } from 'node:fs';
import fsSync from 'node:fs';
import os from 'node:os';

// Main-process crash log — the packed app has no console, so errors land in a file.
const MAIN_LOG = () => path.join(os.tmpdir(), 'qodea-main-errors.log');
function appendMainLog(line: string): void {
  try {
    fsSync.appendFileSync(MAIN_LOG(), `\n[${new Date().toISOString()}] ${line}`);
  } catch {
    /* ignore */
  }
}
process.on('uncaughtException', (err) => {
  appendMainLog(`uncaughtException: ${err.stack ?? String(err)}`);
});
process.on('unhandledRejection', (reason) => {
  appendMainLog(`unhandledRejection: ${String(reason)}`);
});
import { qodeaDir } from '@qodea/core';
import {
  addProject,
  appendMessages,
  deleteProject,
  deleteSession,
  getSession,
  listProjects,
  listSessions,
  touchSession,
} from './store.js';
import { addUsage } from './stats.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.argv.includes('--dev');
const uiDevUrl = 'http://localhost:5173';
// In dev, dist/main.js → ../preload.cjs; packed, main.cjs sits next to preload.cjs.
const preloadPath = app.isPackaged
  ? path.join(__dirname, 'preload.cjs')
  : path.join(__dirname, '../preload.cjs');
const uiProdPath = app.isPackaged
  ? path.join(__dirname, 'ui-dist', 'index.html')
  : path.join(__dirname, '../../ui/dist/index.html');

interface ActiveSession {
  abort: AbortController;
  pendingAsks: Map<string, (approved: boolean) => void>;
  injectQueue: { items: string[] };
}

const sessions = new Map<string, ActiveSession>();
let mainWindowRef: BrowserWindow | null = null;
function getMainWindow(): BrowserWindow | null {
  return mainWindowRef && !mainWindowRef.isDestroyed() ? mainWindowRef : null;
}
let sessionCounter = 0;

function createBrainstormWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 480,
    height: 760,
    minWidth: 380,
    minHeight: 560,
    backgroundColor: '#0b0b0d',
    autoHideMenuBar: true,
    title: 'Qodea Brainstorm',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.webContents.on("preload-error", (_e, p, err) => {
    console.error("[qodea] preload-error:", p, err);
  });

  return win;
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 940,
    minHeight: 600,
    backgroundColor: '#0a0a0c',
    autoHideMenuBar: true,
    title: 'Qodea',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Dev diagnostics: surface renderer/preload failures in the terminal.
  win.webContents.on('preload-error', (_e, p, err) => {
    console.error(`[qodea] preload-error: ${p}:`, err);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[qodea] render-process-gone:', JSON.stringify(details));
  });
  win.webContents.on('did-finish-load', () => {
    void win.webContents
      .executeJavaScript('document.body.innerHTML.length')
      .then((len: number) => appendMainLog(`did-finish-load url=${win.webContents.getURL()} bodyLen=${len}`))
      .catch((e: unknown) =>
        appendMainLog(`did-finish-load probe failed: ${e instanceof Error ? e.message : String(e)}`),
      );
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    appendMainLog(`did-fail-load ${code} ${desc} ${url}`);
  });
  type ConsoleArgs = [
    event: { message?: string; sourceId?: string; lineNumber?: number } | number,
    level?: unknown,
    message?: string,
    line?: unknown,
    sourceId?: string,
  ];
  win.webContents.on('console-message', (...args: ConsoleArgs) => {
    const first = args[0];
    if (typeof first === 'object' && first !== null) {
      const { message, sourceId, lineNumber } = first;
      if (message) console.log(`[renderer] ${message} (${sourceId ?? '?'}:${lineNumber ?? '?'})`);
    } else if (typeof args[2] === 'string') {
      console.log(`[renderer] ${args[2]} (${args[4] ?? '?'}:${String(args[3])})`);
    }
  });

  return win;
}

/** Provider list for the UI picker (never includes API keys). */
async function listProviders() {
  const config = await loadConfig();
  const entries = getEffectiveProviders(config);
  return {
    defaultProvider: config.defaultProvider ?? entries[0]?.id ?? null,
    providers: entries.map((e) => ({
      id: e.id,
      kind: e.kind,
      label: e.label ?? PROVIDER_PRESETS[e.kind].label,
      baseUrl: e.baseUrl ?? null,
      defaultModel: e.defaultModel ?? null,
      azureDeployment: e.azure?.deployment ?? null,
      contextWindow: e.contextWindow ?? 131072,
    })),
  };
}

interface StartRequest {
  sessionId?: string;
  task: string;
  providerId?: string;
  model?: string;
  mode: PermissionMode;
  cwd: string;
  reasoningEffort?: 'low' | 'medium' | 'high';
  uiMode?: 'agent' | 'experts';
  images?: string[];
  brainstorm?: boolean;
  history?: TurnMessage[];
}

interface SaveDraft {
  id: string;
  kind: string;
  label?: string | null;
  baseUrl?: string | null;
  apiKeyEnv?: string | null;
  defaultModel?: string | null;
  contextWindow?: number | null;
  fallbacks?: Array<{ provider: string; model: string }>;
  azureEndpoint?: string | null;
  azureApiVersion?: string | null;
  azureDeployment?: string | null;
  newApiKey?: string;
  clearStoredKey?: boolean;
}

interface ListModelsRequest {
  id?: string;
  kind: string;
  baseUrl?: string;
  azureEndpoint?: string;
  newApiKey?: string;
}

async function startSession(win: BrowserWindow, req: StartRequest) {
  const config = await loadConfig();
  const entries = getEffectiveProviders(config);
  const entry =
    entries.find((e) => e.id === req.providerId) ??
    entries.find((e) => e.kind === req.providerId) ??
    entries[0];
  if (!entry) throw new Error('no provider configured');

  const provider = createProvider(entry);
  const storeId = await touchSession({
    ...(req.sessionId ? { id: req.sessionId } : {}),
    task: req.task,
    ...(req.cwd ? { cwd: req.cwd } : {}),
    providerId: entry.id,
    ...(req.brainstorm ? { kind: 'brainstorm' } : {}),
  });
  const sessionId = storeId;
  const abort = new AbortController();
  const pendingAsks = new Map<string, (approved: boolean) => void>();
  const injectQueue = { items: [] as string[] };
  sessions.set(sessionId, { abort, pendingAsks, injectQueue });

  // permission asker bridges into the renderer as an event + response channel
  let askCounter = 0;
  const asker = async (ask: { tool: string; summary: string }) => {
    const requestId = `${sessionId}-a${++askCounter}`;
    const approved = await new Promise<boolean>((resolve) => {
      pendingAsks.set(requestId, resolve);
      win.webContents.send('qodea:event', sessionId, {
        type: 'permission-request',
        requestId,
        tool: ask.tool,
        summary: ask.summary,
      });
    });
    pendingAsks.delete(requestId);
    return approved;
  };

  const send = (event: AgentEvent | Record<string, unknown>) => {
    if (!win.isDestroyed()) win.webContents.send('qodea:event', sessionId, event);
  };

  // Drive the agent loop and forward every event to the renderer.
  void (async () => {
    try {
      const runModel = req.model ?? entry.defaultModel;
      if (!runModel) throw new Error('no model specified for this provider');

      const agents = mergeAgents(config.agents);

      // ── brainstorm: creative partner chat, single generate_image tool, no file access ──
      let brainstormTools: Tool[] | undefined;
      let brainstormPrompt: string | undefined;
      if (req.brainstorm) {
        const { createGenerateImageTool } = await import('@qodea/core');
        brainstormTools = [
          createGenerateImageTool({
            baseUrl: entry.baseUrl ?? 'https://resources.example',
            apiKey: resolveApiKey(entry),
            models: ['gpt-image-1', 'dall-e-3'],
          }),
        ];
        brainstormPrompt =
          'You are the Brainstorm partner: a creative director in an ONGOING multi-turn design ' +
          'conversation — remember everything discussed earlier and build on it. Rules:\n' +
          '- Ask sharp questions, propose ideas, inspire. Match the user\'s language (Hungarian).\n' +
          '- For ANY UI element under discussion (button, card, hero, layout), output a minimal live ' +
          'preview inside a ```preview fenced block containing ONE small standalone HTML document ' +
          '(inline CSS, single element, no external assets). The user sees it rendered.\n' +
          '- When the user asks for changes: output a NEW preview block. Never repeat the old one — ' +
          'it stays visible above for comparison.\n' +
          '- For visual mood/identity: call generate_image with a vivid prompt.\n' +
          '- Never write project files. Never claim work is done. No [DONE] marker.\n' +
          '- Same anti-slop discipline: no em/en-dashes in visible text, no emoji icons, no ' +
          'Inter-only, no purple-to-indigo gradients, no three identical cards, no fake numbers.\n' +
          '- When the plan and design feel fully agreed, output a "## SPEC" section (goal, pages, ' +
          'features, design direction, tech) and end with the single line: [READY]';
      }

      // ── failover chain from the provider entry's fallbacks list ──
      const allEntries = getEffectiveProviders(config);
      const byId = new Map(allEntries.map((e) => [e.id, e]));
      const failovers = (entry.fallbacks ?? [])
        .map((fb) => {
          const fbEntry = byId.get(fb.provider);
          if (!fbEntry) return null;
          return {
            provider: createProvider(fbEntry),
            model: fb.model,
          };
        })
        .filter((x): x is { provider: NonNullable<typeof x>['provider']; model: string } => x !== null);

      const options: AgentRunOptions = {
        provider,
        model: runModel,
        task: req.task,
        cwd: req.cwd,
        mode: req.brainstorm ? 'yolo' : req.mode,
        asker: req.brainstorm ? undefined : asker,
        signal: abort.signal,
        injectQueue,
        agents,
      };
      if (req.history && req.history.length > 0) options.initialMessages = req.history;
      if (req.reasoningEffort) options.reasoningEffort = req.reasoningEffort;

      if (req.brainstorm) {
        options.systemPrompt = brainstormPrompt;
        options.tools = brainstormTools;
        options.enableSubagents = false;
        options.maxTurns = 200;
      } else {
        options.systemSuffix =
          req.uiMode === 'experts'
            ? '\n\n## ROLE: ORCHESTRATOR (Experts mode)\n' +
              'You lead a team of specialist sub-agents (explorer, worker, reviewer, planner, tester, ' +
              'netlord) and PREFER delegating: break the goal into self-contained subtasks, launch them ' +
              'via spawn_agent in parallel with short Hungarian display names and COMPLETE instructions ' +
              '(sub-agents cannot see this conversation), then synthesize their reports.\n' +
              'You are still fully capable yourself: for trivial one-line fixes or quick answers act ' +
              'directly instead of spawning. When sub-agent results have issues, either send a fix ' +
              'sub-agent or fix it directly — whatever is faster. Never refuse work because you could ' +
              'delegate it; delegation is a preference, not a restriction.'
            : undefined;
      }

      // spawn_agent tool only in Experts mode — plain Agent works alone
      if (!req.brainstorm) {
        options.enableSubagents = req.uiMode === 'experts';
      }

      const iterator = runAgentAuto({
        ...options,
        failovers,
        wallClockMs: 8 * 3600_000,
        stallTimeoutMs: 600_000,
        maxRestarts: 60,
        restartBaseDelayMs: 1500,
      });

      while (true) {
        const { value, done } = await iterator.next();
        if (done) {
          send({
            type: 'session-done',
            reason: value.reason,
            turns: value.turns,
            todos: value.state.todos,
            messages: value.messages,
          });
          await appendMessages(sessionId, value.messages);
          break;
        }
        if (value.type === 'usage') {
          addUsage(
            runModel,
            value.inputTokens ?? 0,
            value.outputTokens ?? 0,
            value.cachedTokens ?? 0,
          );
        }
        send(value);
      }
    } catch (err) {
      send({
        type: 'session-error',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      sessions.delete(sessionId);
    }
  })();

  return { sessionId };
}

function registerIpc(win: () => BrowserWindow): void {
  ipcMain.handle('qodea:providers', () => listProviders());

  // ── settings: read editable drafts (secrets masked) ──────────────────────
  ipcMain.handle('qodea:brainstorm:open', async () => {
    const w = createBrainstormWindow();
    if (isDev) {
      void w.loadURL(uiDevUrl + '/?view=brainstorm');
    } else {
      void w.loadFile(uiProdPath, { search: 'view=brainstorm' });
    }
    return { ok: true };
  });

  ipcMain.handle('qodea:stats:get', async () => {
    const { loadStats } = await import('./stats.js');
    return loadStats();
  });

  ipcMain.handle('qodea:getConfig', async () => {
    const config = await loadConfig();
    const entries = getEffectiveProviders(config);
    const { mergeAgents } = await import('@qodea/core');
    const agents = mergeAgents(config.agents);
    return {
      defaultProvider: config.defaultProvider ?? entries[0]?.id ?? null,
      providers: entries.map((e) => ({
        id: e.id,
        kind: e.kind,
        label: e.label ?? null,
        baseUrl: e.baseUrl ?? null,
        apiKeyEnv: e.apiKeyEnv ?? null,
        defaultModel: e.defaultModel ?? null,
        contextWindow: e.contextWindow ?? null,
        fallbacks: e.fallbacks ?? null,
        azureEndpoint: e.azure?.endpoint ?? null,
        azureApiVersion: e.azure?.apiVersion ?? null,
        azureDeployment: e.azure?.deployment ?? null,
        hasStoredKey: Boolean(e.apiKey),
      })),
      agents: agents.map((a) => ({
        ...a,
        isBuiltin: !config.agents?.some((c) => c.id === a.id),
      })),
    };
  });

  // ── settings: write back (preserving stored keys unless replaced/cleared) ─
  ipcMain.handle(
    'qodea:saveConfig',
    async (_event, payload: {
      defaultProvider: string | null;
      providers: SaveDraft[];
      agents?: Array<{
        id: string;
        name: string;
        color?: string;
        face?: string;
        tools?: string[];
        prompt?: string;
        model?: string;
      }>;
    }) => {
      const prev = await loadConfig();
      const prevById = new Map(prev.providers.map((p) => [p.id, p]));

      let providers: ProviderEntry[];
      if (payload.providers) {
        providers = payload.providers.map((d) => {
        const old = prevById.get(d.id);

        let apiKey: string | undefined;
        if (typeof d.newApiKey === 'string' && d.newApiKey.length > 0) {
          apiKey = d.newApiKey;
        } else if (!d.clearStoredKey && old?.apiKey) {
          apiKey = old.apiKey; // keep the stored secret without echoing it around
        }

        const entry: ProviderEntry = {
          id: d.id,
          kind: d.kind as ProviderEntry['kind'],
          ...(d.label ? { label: d.label } : {}),
          ...(d.baseUrl ? { baseUrl: d.baseUrl } : {}),
          ...(apiKey ? { apiKey } : {}),
          ...(d.apiKeyEnv ? { apiKeyEnv: d.apiKeyEnv } : {}),
          ...(d.defaultModel ? { defaultModel: d.defaultModel } : {}),
          ...(d.contextWindow ? { contextWindow: d.contextWindow } : {}),
          ...(d.fallbacks ? { fallbacks: d.fallbacks } : {}),
          ...(d.azureEndpoint
            ? {
                azure: {
                  endpoint: d.azureEndpoint,
                  apiVersion: d.azureApiVersion || '2024-10-21',
                  ...(d.azureDeployment ? { deployment: d.azureDeployment } : {}),
                },
              }
            : {}),
        };
        return entry;
        });
      } else {
        providers = prev.providers;
      }

      const validated = configSchema.parse({
        version: 1,
        defaultProvider: payload.defaultProvider ?? undefined,
        providers,
        ...(Array.isArray(payload.agents)
          ? {
              agents: payload.agents.map((a) => ({
                id: a.id,
                name: a.name,
                ...(a.color ? { color: a.color } : {}),
                ...(a.face ? { face: a.face } : {}),
                tools: a.tools ?? [],
                prompt: a.prompt ?? '',
                ...(a.model ? { model: a.model } : {}),
              })),
            }
          : {}),
      });

      const file = `${qodeaDir()}/config.json`;
      await fs.mkdir(qodeaDir(), { recursive: true });
      await fs.writeFile(file, JSON.stringify(validated, null, 2) + '\n', 'utf8');
      return { savedTo: file.replace(os.homedir(), '~') };
    },
  );

  // ── settings: list models from an endpoint ───────────────────────────────
  ipcMain.handle(
    'qodea:listModels',
    async (_event, req: ListModelsRequest) => {
      const prev = await loadConfig();
      const saved = prev.providers.find((p) => p.id === req.id);

      let entry: ProviderEntry = {
        id: req.id ?? 'probe',
        kind: req.kind as ProviderEntry['kind'],
        ...(req.baseUrl ? { baseUrl: req.baseUrl } : {}),
        ...(req.azureEndpoint
          ? {
              azure: {
                endpoint: req.azureEndpoint,
                apiVersion: '2024-10-21',
              },
            }
          : {}),
      };

      if (req.newApiKey && req.newApiKey.length > 0) {
        entry = { ...entry, apiKey: req.newApiKey };
      } else if (saved?.apiKey) {
        entry = { ...entry, apiKey: saved.apiKey };
      }

      return { models: await fetchAvailableModels(entry) };
    },
  );

  // ── projects: sidebar folders + native folder picker ─────────────────────
  ipcMain.handle('qodea:projects:list', () => listProjects());

  ipcMain.handle('qodea:projects:add', async () => {
    const result = await dialog.showOpenDialog(win(), {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Projekt mappa kiválasztása',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return addProject(result.filePaths[0]!);
  });

  ipcMain.handle('qodea:projects:delete', (_e, id: string) => deleteProject(id));

  // ── sessions: sidebar tree data ──────────────────────────────────────────
  ipcMain.handle('qodea:sessions:list', async () => {
    const all = await listSessions();
    return all
      .sort((a: { updatedAt: number }, b: { updatedAt: number }) => b.updatedAt - a.updatedAt)
      .map((s) => ({
        id: s.id,
        title: s.title,
        cwd: s.cwd,
        updatedAt: s.updatedAt,
      }));
  });

  ipcMain.handle('qodea:sessions:get', (_e, id: string) => getSession(id));

  ipcMain.handle('qodea:sessions:delete', (_e, id: string) => deleteSession(id));

  ipcMain.handle(
    'qodea:start',
    (_event, req: StartRequest) =>
      startSession(BrowserWindow.fromWebContents(_event.sender) ?? win(), req),
  );

  ipcMain.handle(
    'qodea:respond',
    (_event, payload: { sessionId: string; requestId: string; approved: boolean }) => {
      const resolve = sessions
        .get(payload.sessionId)
        ?.pendingAsks.get(payload.requestId);
      resolve?.(payload.approved);
    },
  );

  ipcMain.handle('qodea:stop', (_event, sessionId: string) => {
    sessions.get(sessionId)?.abort.abort();
  });

  // ── browser panel viewer (live frame + interaction) ──
  ipcMain.handle('qodea:browser:frame', async () => {
    const { getLatestFrame } = await import('@qodea/core');
    return getLatestFrame();
  });

  ipcMain.handle('qodea:browser:navigate', async (_e, url: string) => {
    const { getPage } = await import('@qodea/core');
    const page = await getPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    return page.url();
  });

  ipcMain.handle('qodea:browser:click', async (_e, xPct: number, yPct: number) => {
    const { getPage, clickAt } = await import('@qodea/core');
    const page = await getPage();
    await clickAt(page, xPct, yPct);
  });

  ipcMain.handle('qodea:browser:type', async (_e, text: string) => {
    const { getPage, typeText } = await import('@qodea/core');
    const page = await getPage();
    await typeText(page, text);
  });

  ipcMain.handle('qodea:browser:key', async (_e, key: string) => {
    const { getPage, pressKey } = await import('@qodea/core');
    const page = await getPage();
    await pressKey(page, key);
  });

  // ── brainstorm: hand the agreed plan to a fresh execution session ──
  ipcMain.handle(
    'qodea:brainstorm:materialize',
    async (_e, payload: { sessionId: string }) => {
      const session = await getSession(payload.sessionId);
      if (!session) throw new Error('brainstorm session not found');

      // brief = last assistant message containing the SPEC, else the last message
      let brief = '';
      for (let i = session.messages.length - 1; i >= 0; i--) {
        const m = session.messages[i];
        if (!m) continue;
        if (m.role === 'assistant' && m.content.includes('[READY]')) {
          const idx = m.content.lastIndexOf('## SPEC');
          brief = idx >= 0 ? m.content.slice(idx) : m.content;
          break;
        }
      }
      if (!brief) {
        const firstUser = session.messages.find((m) => m.role === 'user');
        brief = firstUser?.content ?? session.title;
      }

      const goal = session.messages.find((m) => m.role === 'user')?.content ?? session.title;
      const task = `[cwd: ${session.cwd ?? ''}]\n\nOriginal goal:\n${goal}\n\nAGREED SPEC:\n${brief}`;

      const execId = await touchSession({
        task: `Execute the agreed TaskFlow-style plan`,
        ...(session.cwd ? { cwd: session.cwd } : {}),
        providerId: session.providerId,
      });
      await appendMessages(execId, [
        { role: 'user', content: task },
      ]);

      // launch the execution run bound to the MAIN window
      const mainTarget = getMainWindow();
      if (mainTarget) {
        await startSession(mainTarget, {
          sessionId: execId,
          task,
          cwd: session.cwd ?? '.',
          mode: 'yolo',
          uiMode: 'experts',
          ...(session.providerId ? { providerId: session.providerId } : {}),
          ...(session.model ? { model: session.model } : {}),
          history: [{ role: 'user' as const, content: task }],
        });
      }

      return {
        sessionId: execId,
        task,
        cwd: session.cwd ?? '',
      };
    },
  );

  ipcMain.handle('qodea:brainstorm:close', (event) => {
    const w = BrowserWindow.fromWebContents(event.sender);
    w?.close();
  });

  ipcMain.handle('qodea:sendMessage', (_event, payload: { sessionId: string; text: string }) => {
    const s = sessions.get(payload.sessionId);
    if (!s) return { queued: false };
    s.injectQueue.items.push(payload.text);
    return { queued: true };
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.whenReady().then(() => {
    let mainWindow = createWindow();
    mainWindowRef = mainWindow;

    registerIpc(() => mainWindow);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow();
      }
    });

    if (isDev) {
      void loadDev(mainWindow);
    } else {
      mainWindow.loadFile(uiProdPath);
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

/** Keeps retrying while the Vite dev server warms up, so start order never matters. */
async function loadDev(win: BrowserWindow): Promise<void> {
  const maxAttempts = 90;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (win.isDestroyed()) return;
    try {
      await win.loadURL(uiDevUrl);
      return;
    } catch {
      if (attempt === 1) {
        console.log(`[qodea] waiting for UI dev server at ${uiDevUrl} ...`);
        console.log('[qodea] (ha sokáig áll: fut még egy régi pnpm/electron? taskkill /IM electron.exe /F)');
      }
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
  }
  console.error(`[qodea] gave up waiting for the UI dev server at ${uiDevUrl}`);
}
