import { InvalidArgsError } from '../types.js';
import type { Tool } from '../types.js';
import {
  clearConsoleBuffer,
  getConsoleBuffer,
  getPage,
  pressKey,
  startScreencast,
  typeText,
} from './controller.js';

/** Panel-viewer tools: live screencast + direct keyboard interaction. */
export function createBrowserPanelTools(): Tool[] {
  return [browser_screencast, browser_type_text, browser_press_key, browser_console];
}

const browser_screencast: Tool = {
  name: 'browser_screencast',
  description: 'Start the live browser stream for the user panel (call once after navigate).',
  kind: 'read',
  parametersJsonSchema: { type: 'object', properties: {} },
  describe() {
    return 'start live browser stream';
  },
  async run() {
    const page = await getPage();
    startScreencast(page);
    return 'Live stream elindítva a user panelen.';
  },
};

const browser_type_text: Tool = {
  name: 'browser_type_text',
  description: 'Type text into the currently focused element.',
  kind: 'write',
  parametersJsonSchema: {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
  },
  describe(args) {
    const t = String(args['text'] ?? '');
    return `type: ${t.length > 40 ? `${t.slice(0, 40)}…` : t}`;
  },
  async run(rawArgs) {
    if (typeof rawArgs['text'] !== 'string') {
      throw new InvalidArgsError('browser_type_text requires "text"');
    }
    const page = await getPage();
    await typeText(page, rawArgs['text'], false);
    return 'beírva';
  },
};

const browser_press_key: Tool = {
  name: 'browser_press_key',
  description: 'Press a keyboard key in the browser (e.g. Enter, Tab, Escape).',
  kind: 'write',
  parametersJsonSchema: {
    type: 'object',
    properties: { key: { type: 'string' } },
    required: ['key'],
  },
  describe(args) {
    return `press: ${String(args['key'] ?? '?')}`;
  },
  async run(rawArgs) {
    const key = rawArgs['key'];
    if (typeof key !== 'string') throw new InvalidArgsError('requires "key"');
    const page = await getPage();
    await pressKey(page, key);
    return `key: ${key}`;
  },
};

const browser_console: Tool = {
  name: 'browser_console',
  description:
    'Return collected browser console messages and page errors since the last check. QA essential.',
  kind: 'read',
  parametersJsonSchema: { type: 'object', properties: {} },
  describe() {
    return 'konzol hibák gyűjtése';
  },
  async run() {
    const buf = getConsoleBuffer();
    clearConsoleBuffer();
    if (buf.length === 0) return '(nincs konzol kimenet)';
    return buf.map((b) => `[${b.type}] ${b.text}`).join('\n');
  },
};
