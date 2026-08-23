import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { webFetchTool, webSearchTool } from '../src/index.js';

const tempHomes: string[] = [];
const fetchStub = vi.fn();

beforeAll(() => {
  vi.stubGlobal('fetch', fetchStub);
});

afterEach(() => {
  fetchStub.mockClear();
  vi.unstubAllEnvs();
  delete process.env['QODEA_WEB_TEST'];
});

afterAll(() => {
  for (const dir of tempHomes) void rm(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

async function withHome(searxngUrl?: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'qodea-web-'));
  tempHomes.push(dir);
  await mkdir(path.join(dir), { recursive: true });
  const cfg: Record<string, unknown> = { version: 1, providers: [] };
  if (searxngUrl) cfg['web'] = { searxngUrl };
  await writeFile(
    path.join(dir, 'config.json'),
    JSON.stringify(cfg),
    'utf8',
  );
  process.env['QODEA_HOME'] = dir;
  return dir;
}

function respond(status: number, body: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => JSON.parse(body),
  } as unknown as Response;
}

const DDG_HTML = `
<div class="result">
  <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fcomet&amp;rut=abc">Perplexity Comet overview</a>
  <a class="result__snippet">The agentic browser <b>from Perplexity</b> explained.</a>
</div>
<div class="result">
  <a class="result__a" href="https://second.example.com/x">Second hit</a>
  <a class="result__snippet">Another snippet here.</a>
</div>`;

const SEARXNG_JSON = JSON.stringify({
  results: [
    { title: 'SearXNG first', url: 'https://sx.example/1', content: 'legjobb találat' },
    { title: 'SearXNG second', url: 'https://sx.example/2', content: 'másik' },
  ],
});

describe('web_search chain', () => {
  it('uses SearXNG first when configured', async () => {
    await withHome('http://127.0.0.1:8888');
    fetchStub.mockImplementation((url: string | URL) => {
      const u = String(url);
      if (u.includes('format=json')) return Promise.resolve(respond(200, SEARXNG_JSON));
      throw new Error('unexpected call: ' + u);
    });

    const out = await webSearchTool.run({ query: 'perplexity comet' }, ctx());
    expect(out).toContain('[forrás: searxng]');
    expect(out).toContain('SearXNG first');
    expect(out).toContain('https://sx.example/1');
  });

  it('falls back to built-in DuckDuckGo scraping without any config', async () => {
    await withHome(undefined); // no searxng configured
    let ddgCalled = false;
    fetchStub.mockImplementation((url: string | URL) => {
      const u = String(url);
      if (u.includes('html.duckduckgo.com')) {
        ddgCalled = true;
        return Promise.resolve(respond(200, DDG_HTML));
      }
      return Promise.resolve(respond(500, '{}'));
    });

    const out = await webSearchTool.run({ query: 'comet browser' }, ctx());
    expect(ddgCalled).toBe(true);
    expect(out).toContain('[forrás: duckduckgo]');
    // uddg redirect param decoded to the real URL
    expect(out).toContain('https://example.org/comet');
    expect(out).toContain('Second hit');
  });
});

describe('web_fetch', () => {
  it('strips HTML down to readable text', async () => {
    await withHome(undefined);
    fetchStub.mockResolvedValue(
      respond(
        200,
        '<html><head><style>.x{color:red}</style></head><body><h1>Hello &amp; welcome</h1><script>evil()</script><p>Nice&nbsp;content</p></body></html>',
      ),
    );

    const out = await webFetchTool.run({ url: 'https://example.org/page' }, ctx());
    expect(out).toContain('https://example.org/page');
    expect(out).toContain('Hello & welcome');
    expect(out).toContain('Nice content');
    expect(out).not.toContain('evil()');
    expect(out).not.toContain('<h1>');
  });

  it('rejects non-http urls', async () => {
    await withHome(undefined);
    await expect(
      webFetchTool.run({ url: 'file:///C:/secrets' }, ctx()),
    ).rejects.toThrow(/http/);
  });
});

function ctx() {
  return { cwd: process.cwd(), state: { todos: [], approvedActions: new Set<string>() } };
}
