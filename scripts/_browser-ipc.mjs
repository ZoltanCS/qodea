import fs from 'node:fs';

const f = 'packages/desktop/src/main.ts';
let t = fs.readFileSync(f, 'utf8');

const marker = "  ipcMain.handle('qodea:sendMessage'";
const add = [
  "  // ── browser panel viewer (live frame + interaction) ──",
  "  ipcMain.handle('qodea:browser:frame', async () => {",
  "    const { getLatestFrame } = await import('@qodea/core');",
  "    return getLatestFrame();",
  "  });",
  "",
  "  ipcMain.handle('qodea:browser:navigate', async (_e, url: string) => {",
  "    const { getPage } = await import('@qodea/core');",
  "    const page = await getPage();",
  "    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });",
  "    return page.url();",
  "  });",
  "",
  "  ipcMain.handle('qodea:browser:click', async (_e, xPct: number, yPct: number) => {",
  "    const { getPage, clickAt } = await import('@qodea/core');",
  "    const page = await getPage();",
  "    await clickAt(page, xPct, yPct);",
  "  });",
  "",
  "  ipcMain.handle('qodea:browser:type', async (_e, text: string) => {",
  "    const { getPage, typeText } = await import('@qodea/core');",
  "    const page = await getPage();",
  "    await typeText(page, text);",
  "  });",
  "",
  "  ipcMain.handle('qodea:browser:key', async (_e, key: string) => {",
  "    const { getPage, pressKey } = await import('@qodea/core');",
  "    const page = await getPage();",
  "    await pressKey(page, key);",
  "  });",
  "",
].join('\n');

if (!t.includes('qodea:browser:frame')) {
  t = t.replace(marker, add + '\n' + marker);
}

fs.writeFileSync(f, t);
console.log('ipc handlers added');
