import { InvalidArgsError } from '../types.js';

/**
 * Comet-style browser control via Playwright.
 * Uses system-installed Chrome (channel: 'chrome') — no browser download needed.
 * Visible window by default; single shared session per app run.
 * Pattern: snapshot → act(ref) → snapshot.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

type PW = any;

let pwMod: PW | null = null;
let browser: any = null;
let context: any = null;
let page: any = null;
let lastLaunchOpts: Record<string, unknown> | null = null;

async function loadPlaywright(): Promise<PW> {
  if (pwMod) return pwMod;
  try {
    pwMod = await import('playwright' as string);
  } catch {
    throw new InvalidArgsError(
      'A Playwright nincs telepítve. Futtasd: pnpm add playwright (a core csomagba)',
    );
  }
  return pwMod;
}

export async function getPage(opts?: { headless?: boolean }): Promise<any> {
  const pw = await loadPlaywright();
  const headless = opts?.headless ?? false;

  if (!browser || !browser.isConnected()) {
    // Chrome → Edge (Windows guaranteed) → downloaded chromium
    const attempts: Array<Record<string, unknown>> = [
      { channel: 'chrome', headless },
      { channel: 'msedge', headless },
      { headless },
    ];
    let lastError: unknown;
    let launched = false;
    for (const attempt of attempts) {
      try {
        browser = await pw.chromium.launch(attempt);
        lastLaunchOpts = attempt;
        launched = true;
        break;
      } catch (err) {
        lastError = err;
      }
    }
    if (!launched) {
      throw new Error(
        'Nem sikerült böngészőt indítani (Chrome/Edge/chromium).\n' +
          'Futtasd egyszer: pnpm exec playwright install chromium\n' +
          `Utolsó hiba: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
      );
    }
    context = await browser.newContext();
  }
  if (!page || page.isClosed()) {
    page = await context.newPage();
    page.setDefaultTimeout(20000);
    attachPageLogging(page);
  }
  return page;
}

export async function closeBrowser(): Promise<string> {
  if (!browser) return 'No open browser.';
  await browser.close().catch(() => {});
  browser = null;
  context = null;
  page = null;
  return 'Browser closed.';
}

/** Numbered interactive-element listing for the LLM. */
export async function takeSnapshot(page: any): Promise<string> {
  const title = await page.title();
  const url = page.url();

  const items: Array<{ i: number; tag: string; text: string; extra: string }> =
    await page.evaluate(`
      (() => {
        const doc = globalThis.document;
        const nodes = Array.from(
          doc.querySelectorAll(
            'a[href], button, input, select, textarea, [role="button"], [role="link"], [role="textbox"], [contenteditable="true"]',
          ),
        );
        const out = [];
        let n = 0;
        for (const el of nodes.slice(0, 80)) {
          const tag = el.tagName.toLowerCase();
          el.setAttribute('data-qref', String(n));
          const text = (el.innerText || el.getAttribute('value') || '')
            .trim()
            .replace(/\\s+/g, ' ')
            .slice(0, 60);
          let extra = '';
          if (tag === 'a' && el.href) extra += ' href=' + String(el.href).slice(0, 80);
          const ph = el.getAttribute('placeholder');
          if (ph) extra += ' placeholder="' + ph + '"';
          if (el.getAttribute('type')) extra += ' type=' + el.getAttribute('type');
          out.push({ i: n, tag, text, extra });
          n++;
        }
        return out;
      })()
    `);

  const list = items
    .map(
      (it) =>
        `[${it.i}] <${it.tag}${it.extra}> ${it.text}`,
    )
    .join('\n');

  return `[${title}] (${url})\n\nInteraktív elemek:\n${list || '(nincs a látható területen)'}`;
}

function qref(ref: unknown): string {
  const n = Number(ref);
  if (!Number.isInteger(n) || n < 0) {
    throw new InvalidArgsError('érvénytelen ref — friss snapshotból vedd a számot');
  }
  return `[data-qref="${n}"]`;
}

export async function clickRef(page: any, ref: unknown): Promise<void> {
  await page.click(qref(ref), { timeout: 8000 });
}

export async function typeIntoRef(
  page: any,
  ref: unknown,
  text: string,
  submit: boolean,
): Promise<void> {
  const sel = qref(ref);
  await page.click(sel, { timeout: 8000 });
  await page.fill(sel, '').catch(() => {});
  await page.keyboard.type(text, { delay: 8 });
  if (submit) await page.keyboard.press('Enter');
}

export async function scrollBy(page: any, delta: number): Promise<void> {
  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, delta);
  await page.waitForTimeout(250);
}

export async function screenshotTo(page: any, file: string): Promise<void> {
  await page.screenshot({ path: file, fullPage: false });
}

/** Snapshot helper shared by several tools (returns fresh listing after actions). */
export async function freshSnapshotLine(page: any): Promise<string> {
  const url = page.url();
  const title = await page.title().catch(() => '');
  return `${title} (${url})`;
}

/* ── live screencast + interaction (panel viewer) ── */

let latestFrame: string | null = null;
let cdp: any = null;
let casting = false;
const consoleBuf: Array<{ type: string; text: string }> = [];

export function startScreencast(page: any): void {
  if (casting) return;
  casting = true;
  void (async () => {
    try {
      cdp = await page.context().newCDPSession(page);
      cdp.on('Page.screencastFrame', (ev: any) => {
        latestFrame = ev.data;
        cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {});
      });
      await cdp.send('Page.startScreencast', {
        format: 'jpeg',
        quality: 55,
        maxWidth: 1280,
        maxHeight: 800,
        everyNthFrame: 1,
      });
    } catch {
      casting = false;
    }
  })();
}

export function getLatestFrame(): string | null {
  return latestFrame;
}

export async function clickAt(page: any, xPct: number, yPct: number): Promise<void> {
  const vp = page.viewportSize() ?? { width: 1280, height: 800 };
  await page.mouse.click(
    Math.round((xPct / 100) * vp.width),
    Math.round((yPct / 100) * vp.height),
  );
}

export async function typeText(page: any, text: string, submit = false): Promise<void> {
  await page.keyboard.type(text, { delay: 8 });
  if (submit) await page.keyboard.press('Enter');
}

export async function pressKey(page: any, key: string): Promise<void> {
  await page.keyboard.press(key);
}

export function getConsoleBuffer(): Array<{ type: string; text: string }> {
  return consoleBuf.slice(-100);
}

export function clearConsoleBuffer(): void {
  consoleBuf.length = 0;
}

/** Wire console/pageerror collection when a page is created. */
export function attachPageLogging(page: any): void {
  page.on('console', (msg: any) => {
    if (consoleBuf.length > 200) consoleBuf.shift();
    consoleBuf.push({ type: msg.type(), text: String(msg.text()).slice(0, 300) });
  });
  page.on('pageerror', (err: Error) => {
    if (consoleBuf.length > 200) consoleBuf.shift();
    consoleBuf.push({ type: 'pageerror', text: String(err?.message ?? err).slice(0, 300) });
  });
}
