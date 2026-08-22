import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createProvider,
  getEffectiveProviders,
  loadConfig,
  PROVIDER_PRESETS,
  runAgent,
  type AgentEvent,
  type AgentRunOptions,
  type PermissionMode,
  type TurnMessage,
} from '@qodea/core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.argv.includes('--dev');
const uiDevUrl = 'http://localhost:5173';

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
      preload: path.join(__dirname, '../preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
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
  task: string;
  providerId?: string;
  model?: string;
  mode: PermissionMode;
  cwd: string;
  reasoningEffort?: 'low' | 'medium' | 'high';
  history?: TurnMessage[];
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
  const sessionId = `s${++sessionCounter}`;
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
        mode: req.mode,
        asker,
        signal: abort.signal,
      };
      if (req.history && req.history.length > 0) options.initialMessages = req.history;
      if (req.reasoningEffort) options.reasoningEffort = req.reasoningEffort;

      const iterator = runAgent(options);

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
      mainWindow.loadFile(path.join(__dirname, '../../ui/dist/index.html'));
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
      if (attempt === 1) console.log(`[qodea] waiting for UI dev server at ${uiDevUrl} ...`);
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
  }
  console.error(`[qodea] gave up waiting for the UI dev server at ${uiDevUrl}`);
}
