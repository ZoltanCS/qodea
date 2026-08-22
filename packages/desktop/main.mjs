import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.argv.includes('--dev');
const uiDevUrl = 'http://localhost:5173';

function createWindow() {
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
    win.loadURL(uiDevUrl);
    win.webContents.on('did-fail-load', () => {
      console.error(`[qodea] could not reach UI dev server at ${uiDevUrl}`);
      console.error('[qodea] start it with: pnpm --filter @qodea/ui dev');
    });
  } else {
    win.loadFile(path.join(__dirname, '../ui/dist/index.html'));
  }
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
