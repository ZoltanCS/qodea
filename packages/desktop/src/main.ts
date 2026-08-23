import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createProvider,
  fetchAvailableModels,
  getEffectiveProviders,
  loadConfig,
  PROVIDER_PRESETS,
  runAgent,
  runAgentAuto,
  configSchema,
  type AgentEvent,
  type AgentRunOptions,
  type PermissionMode,
  type ProviderEntry,
  type TurnMessage,
} from '@qodea/core';
import { promises as fs } from 'node:fs';
import os from 'node:os';
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
}

const sessions = new Map<string, ActiveSession>();
let sessionCounter = 0;

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
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[qodea] did-fail-load ${code} ${desc} ${url}`);
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
  uiMode?: 'agent' | 'experts' | 'autonomous';
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
  });
  const sessionId = storeId;
  const abort = new AbortController();
  const pendingAsks = new Map<string, (approved: boolean) => void>();
  sessions.set(sessionId, { abort, pendingAsks });

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

      const options: AgentRunOptions = {
        provider,
        model: runModel,
        task: req.task,
        cwd: req.cwd,
        mode: req.uiMode === 'autonomous' ? 'yolo' : req.mode,
        asker,
        signal: abort.signal,
      };
      if (req.history && req.history.length > 0) options.initialMessages = req.history;
      if (req.reasoningEffort) options.reasoningEffort = req.reasoningEffort;

      if (req.uiMode === 'autonomous') {
        // FULL AUTONOMY: hours-long run, auto-restart on errors, stall watchdog.
        // The only exit: [DONE] marker, wall clock, restart limits, or user Stop.
        options.systemSuffix =
          '\n\nYou are running in FULL AUTONOMOUS mode. Drive the task forward continuously ' +
          'without asking for confirmation. Work in focused cycles: act → verify → next step. ' +
          'If something fails, diagnose and retry a different approach — never repeat a failed one. ' +
          'When the ENTIRE goal is complete AND verified, end your final message with the single line: [DONE]';
      } else {
        options.systemSuffix =
          req.uiMode === 'experts'
            ? '\n\nMulti-agent mode is available: you have a spawn_agent tool and specialist sub-agents ' +
              '(explorer, worker, reviewer, planner, tester, netlord). Prefer orchestrating: plan the work, then ' +
              'delegate parallel, self-contained subtasks to suitable specialists with clear Hungarian ' +
              'display names, and synthesize their reports for the user. Keep each instruction complete — ' +
              'sub-agents cannot see this conversation.'
            : undefined;
      }

      const iterator =
        req.uiMode === 'autonomous'
          ? runAgentAuto({
              ...options,
              wallClockMs: 8 * 3600_000,
              stallTimeoutMs: 600_000,
              maxRestarts: 60,
              restartBaseDelayMs: 1500,
            })
          : runAgent(options);

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
  ipcMain.handle('qodea:getConfig', async () => {
    const config = await loadConfig();
    const entries = getEffectiveProviders(config);
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
        azureEndpoint: e.azure?.endpoint ?? null,
        azureApiVersion: e.azure?.apiVersion ?? null,
        azureDeployment: e.azure?.deployment ?? null,
        hasStoredKey: Boolean(e.apiKey),
      })),
    };
  });

  // ── settings: write back (preserving stored keys unless replaced/cleared) ─
  ipcMain.handle(
    'qodea:saveConfig',
    async (_event, payload: { defaultProvider: string | null; providers: SaveDraft[] }) => {
      const prev = await loadConfig();
      const prevById = new Map(prev.providers.map((p) => [p.id, p]));

      const providers: ProviderEntry[] = payload.providers.map((d) => {
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

      const validated = configSchema.parse({
        version: 1,
        defaultProvider: payload.defaultProvider ?? undefined,
        providers,
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
    (_event, req: StartRequest) => startSession(win(), req),
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
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.whenReady().then(() => {
    let mainWindow = createWindow();

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
