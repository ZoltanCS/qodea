import path from 'node:path';
import os from 'node:os';
import { InvalidArgsError } from './types.js';
import type { Tool } from './types.js';
import {
  clickRef,
  closeBrowser,
  freshSnapshotLine,
  getPage,
  screenshotTo,
  scrollBy,
  takeSnapshot,
  typeIntoRef,
} from './browser/controller.js';

/** Comet-style browser toolset (shared single session). */
export function createBrowserTools(): Tool[] {
  return [
    browser_navigate,
    browser_snapshot,
    browser_click,
    browser_type,
    browser_scroll,
    browser_screenshot,
    browser_close,
  ];
}

const browser_navigate: Tool = {
  name: 'browser_navigate',
  description:
    'Open a URL in the visible Chrome window. Returns the page title and clickable element list.',
  kind: 'write',
  parametersJsonSchema: {
    type: 'object',
    properties: { url: { type: 'string' } },
    required: ['url'],
  },
  describe(args) {
    const u = String(args['url'] ?? '?');
    return `megnyitja a böngészőben: ${u.length > 60 ? `${u.slice(0, 60)}…` : u}`;
  },
  async run(rawArgs) {
    const url = rawArgs['url'];
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      throw new InvalidArgsError('browser_navigate requires an http(s) "url"');
    }
    const page = await getPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    return takeSnapshot(page);
  },
};

const browser_snapshot: Tool = {
  name: 'browser_snapshot',
  description:
    'List the interactive elements of the current page with numbered refs. Use refs with browser_click / browser_type.',
  kind: 'read',
  parametersJsonSchema: { type: 'object', properties: {} },
  describe() {
    return 'elemek felsorolása az aktuális oldalról';
  },
  async run() {
    const page = await getPage();
    return takeSnapshot(page);
  },
};

const browser_click: Tool = {
  name: 'browser_click',
  description:
    'Click the element with the given ref (from browser_snapshot). Returns the fresh element list after clicking.',
  kind: 'write',
  parametersJsonSchema: {
    type: 'object',
    properties: { ref: { type: 'number' } },
    required: ['ref'],
  },
  describe(args) {
    return `kattint: [${String(args['ref'] ?? '?')}]`;
  },
  async run(rawArgs) {
    const page = await getPage();
    await clickRef(page, rawArgs['ref']);
    await page.waitForTimeout(400);
    return freshSnapshotLine(page) + '\n\n' + (await takeSnapshot(page));
  },
};

const browser_type: Tool = {
  name: 'browser_type',
  description:
    'Type text into the element with the given ref (input/textarea). Set submit=true to press Enter.',
  kind: 'write',
  parametersJsonSchema: {
    type: 'object',
    properties: {
      ref: { type: 'number' },
      text: { type: 'string' },
      submit: { type: 'boolean', description: 'Press Enter after typing.' },
    },
    required: ['ref', 'text'],
  },
  describe(args) {
    const t = String(args['text'] ?? '');
    return `beír: [${String(args['ref'] ?? '?')}] ${t.length > 40 ? `${t.slice(0, 40)}…` : t}`;
  },
  async run(rawArgs) {
    if (typeof rawArgs['ref'] === 'undefined' || typeof rawArgs['text'] !== 'string') {
      throw new InvalidArgsError('browser_type requires "ref" and "text"');
    }
    const page = await getPage();
    await typeIntoRef(page, rawArgs['ref'], rawArgs['text'], rawArgs['submit'] === true);
    return freshSnapshotLine(page);
  },
};

const browser_scroll: Tool = {
  name: 'browser_scroll',
  description: 'Scroll the page. Positive amount scrolls down, negative scrolls up.',
  kind: 'write',
  parametersJsonSchema: {
    type: 'object',
    properties: { amount: { type: 'number', description: 'Pixels (default 600).' } },
  },
  describe(args) {
    const a = Number(args['amount'] ?? 600);
    return `görget ${a > 0 ? 'lefelé' : 'felfelé'} ${Math.abs(a)}px`;
  },
  async run(rawArgs, ctx) {
    const page = await getPage();
    const amount =
      typeof rawArgs['amount'] === 'number' ? rawArgs['amount'] : 600;
    await scrollBy(page, amount);
    void ctx;
    return freshSnapshotLine(page);
  },
};

const browser_screenshot: Tool = {
  name: 'browser_screenshot',
  description: 'Save a PNG screenshot of the current page and return its file path.',
  kind: 'write',
  parametersJsonSchema: { type: 'object', properties: {} },
  describe() {
    return 'képernyőképet ment';
  },
  async run() {
    const page = await getPage();
    const file = path.join(os.tmpdir(), `qodea-shot-${Date.now()}.png`);
    await screenshotTo(page, file);
    return `Képernyőkép mentve: ${file}`;
  },
};

const browser_close: Tool = {
  name: 'browser_close',
  description: 'Close the controlled browser window.',
  kind: 'write',
  parametersJsonSchema: { type: 'object', properties: {} },
  describe() {
    return 'böngészőt bezár';
  },
  async run() {
    return closeBrowser();
  }
};
