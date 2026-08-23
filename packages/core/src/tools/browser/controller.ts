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
  }
  return page;
}

export async function closeBrowser(): Promise<string> {
  if (!browser) return 'Nincs nyitott böngésző.';
  await browser.close().catch(() => {});
  browser = null;
  context = null;
  page = null;
  return 'Böngésző bezárva.';
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
