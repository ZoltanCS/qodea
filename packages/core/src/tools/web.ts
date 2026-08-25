import { InvalidArgsError, type Tool } from './types.js';
import { loadConfig } from '../config/loader.js';

const MAX_RESULTS = 8;
const MAX_FETCH_CHARS = 9_000;

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/* ── shared helpers ─────────────────────────────────────────────────────── */

async function httpText(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36',
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/\s+/g, ' ');
}

/* ── backends ───────────────────────────────────────────────────────────── */

async function searchSearxng(base: string, query: string): Promise<SearchResult[]> {
  const url = `${base.replace(/\/$/, '')}/search?q=${encodeURIComponent(query)}&format=json`;
  const { ok, status, body } = await httpText(url);
  if (!ok) throw new Error(`SearXNG HTTP ${status}`);
  const json = JSON.parse(body) as { results?: Array<{ title?: string; url?: string; content?: string }> };
  return (json.results ?? [])
    .filter((r) => r.url && r.title)
    .slice(0, MAX_RESULTS)
    .map((r) => ({ title: r.title!, url: r.url!, snippet: r.content ?? '' }));
}

/** Zero-config fallback: DuckDuckGo HTML endpoint scraping. */
async function searchDdg(query: string): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const { ok, status, body } = await httpText(url);
  if (!ok || /anomaly|challenge/i.test(body)) {
    throw new Error(`DuckDuckGo HTTP ${status} (botvédelem?)`);
  }

  const out: SearchResult[] = [];
  const linkRe = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippets = [...body.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi)].map(
    (m) => stripTags(m[1] ?? ''),
  );

  let i = 0;
  for (const m of body.matchAll(linkRe)) {
    let href = decodeEntities(m[1] ?? '');
    const uddg = /[?&]uddg=([^&]+)/.exec(href)?.[1];
    if (uddg) href = decodeURIComponent(uddg);
    if (!/^https?:\/\//i.test(href)) continue;
    out.push({
      title: stripTags(m[2] ?? '').slice(0, 120),
      url: href,
      snippet: snippets[i] ?? '',
    });
    i++;
    if (out.length >= MAX_RESULTS) break;
  }
  return out;
}

async function searchTavily(key: string, query: string): Promise<SearchResult[]> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ api_key: key, query, max_results: MAX_RESULTS }),
  });
  const json = (await res.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
  if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
  return (json.results ?? [])
    .filter((r) => r.url)
    .map((r) => ({ title: r.title ?? r.url!, url: r.url!, snippet: r.content ?? '' }));
}

/** Second DDG fallback: the lite endpoint (different rate-limit pool). */
async function searchDdgLite(query: string): Promise<SearchResult[]> {
  const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
  const { ok, status, body } = await httpText(url);
  if (!ok) throw new Error(`DDG-lite HTTP ${status}`);
  const out: SearchResult[] = [];
  for (const m of body.matchAll(/<a[^>]+class="result-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    let href = decodeEntities(m[1] ?? '');
    const uddg = /[?&]uddg=([^&]+)/.exec(href)?.[1];
    if (uddg) href = decodeURIComponent(uddg);
    if (!/^https?:\/\//i.test(href)) continue;
    out.push({
      title: stripTags(m[2] ?? '').slice(0, 120),
      url: href,
      snippet: '',
    });
    if (out.length >= MAX_RESULTS) break;
  }
  return out;
}
/* ── the two tools ──────────────────────────────────────────────────────── */

export const webSearchTool: Tool = {
  name: 'web_search',
  description:
    'Search the web (no API key needed). Returns ranked results with title, URL and snippet.',
  kind: 'read',
  parametersJsonSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search keywords.' },
    },
    required: ['query'],
  },
  describe(args) {
    const q = String(args['query'] ?? '?');
    return `megkeresi a neten: ${q.length > 60 ? `${q.slice(0, 60)}…` : q}`;
  },

  async run(rawArgs) {
    const query = rawArgs['query'];
    if (typeof query !== 'string' || !query.trim()) {
      throw new InvalidArgsError('web_search requires a "query" string');
    }

    // resolve optional SearXNG base from config (~/.qodea/config.json → web.searxngUrl)
    let searxngUrl: string | undefined;
    try {
      const cfg = await loadConfig();
      searxngUrl = cfg.web?.searxngUrl;
    } catch {
      /* config problems must not block the fallback chain */
    }

    const attempts: Array<{ src: string; fn: () => Promise<SearchResult[]> }> = [];
    if (searxngUrl) attempts.push({ src: 'searxng', fn: () => searchSearxng(searxngUrl!, query) });
    attempts.push({ src: 'duckduckgo', fn: () => searchDdg(query) });
    attempts.push({ src: 'duckduckgo-lite', fn: () => searchDdgLite(query) });

    const tavilyKey =
      process.env['TAVILY_API_KEY'] ?? process.env['QODEA_TAVILY_API_KEY'];
    if (tavilyKey) attempts.push({ src: 'tavily', fn: () => searchTavily(tavilyKey, query) });

    const errors: string[] = [];
    for (const attempt of attempts) {
      try {
        const results = await attempt.fn();
        if (results.length === 0) continue;
        return [
          `[forrás: ${attempt.src}]`,
          ...results.map(
            (r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet.slice(0, 160)}`,
          ),
        ].join('\n');
      } catch (err) {
        errors.push(`${attempt.src}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    throw new Error(
      `Minden kereső háttér sikertelen.\n${errors.map((e) => `- ${e}`).join('\n')}\n\nTipp: futtass lokál SearXNG-t (docker) és állítsd be: web.searxngUrl`,
    );
  },
};

export const webFetchTool: Tool = {
  name: 'web_fetch',
  description:
    'Download a web page and return its readable text content (HTML stripped, truncated). Use after web_search to actually read a result.',
  kind: 'read',
  parametersJsonSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Full http(s) URL.' },
    },
    required: ['url'],
  },
  describe(args) {
    const u = String(args['url'] ?? '?');
    return `letölti: ${u.length > 70 ? `${u.slice(0, 70)}…` : u}`;
  },

  async run(rawArgs) {
    const url = rawArgs['url'];
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      throw new InvalidArgsError('web_fetch requires a valid http(s) "url"');
    }
    const { ok, status, body } = await httpText(url);
    if (!ok) throw new Error(`HTTP ${status} for ${url}`);

    const contentType = '';
    void contentType;
    const text = stripTags(body);
    if (!text.trim()) return `(page has no extractable text) ${url}`;

    const cut = text.slice(0, MAX_FETCH_CHARS);
    return `[${url} · ${text.length} karakter]\n${cut}${text.length > MAX_FETCH_CHARS ? '\n[... truncated]' : ''}`;
  },
};
