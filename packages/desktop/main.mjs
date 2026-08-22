import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.argv.includes('--dev');
const uiDevUrl = 'http://localhost:5173';

async function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 600,
    backgroundColor: '#0a0a0c',
    autoHideMenuBar: true,
    title: 'Qodea',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDev) {
    await loadWithRetry(win);
  } else {
    win.loadFile(path.join(__dirname, '../ui/dist/index.html'));
  }
}

/** Keeps retrying while the Vite dev server warms up, so start order never matters. */
async function loadWithRetry(win) {
  const maxAttempts = 90;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (win.isDestroyed()) return;
    try {
      await win.loadURL(uiDevUrl);
      return;
    } catch {
      if (attempt === 1) {
        console.log(`[qodea] waiting for UI dev server at ${uiDevUrl} ...`);
      }
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
  }
  console.error(`[qodea] gave up waiting for the UI dev server at ${uiDevUrl}`);
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
