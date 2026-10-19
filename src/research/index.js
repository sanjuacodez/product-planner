/**
 * Free, key-less web research helpers so any agent (even one without native web tools)
 * can search and read pages via a shell command. Uses the DuckDuckGo HTML endpoint.
 */
const UA = 'Mozilla/5.0 (compatible; product-planner/0.1; +https://github.com/)';

export async function search(query, { max = 8, region = 'wt-wt' } = {}) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=${encodeURIComponent(region)}`;
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`search failed: HTTP ${res.status}`);
  const html = await res.text();
  if (/anomaly-modal|challenge-form/i.test(html)) throw new Error('DuckDuckGo requires a browser challenge; use native web tools or an agreed alternative');
  return parseDuckDuckGo(html).slice(0, max);
}

export function parseDuckDuckGo(html) {
  const results = [];
  const blocks = html.split(/<div[^>]+class="[^"]*\bresult\b[^"]*"/).slice(1);
  for (const b of blocks) {
    const a = b.match(/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    const snip = b.match(/<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/) || b.match(/<div[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    results.push({ title: clean(a[2]), url: unwrap(a[1]), snippet: snip ? clean(snip[1]) : '' });
  }
  return results;
}
function unwrap(href) {
  const m = href.match(/[?&]uddg=([^&]+)/);
  let u = m ? decodeURIComponent(m[1]) : href;
  if (u.startsWith('//')) u = 'https:' + u;
  return u;
}
export function clean(s) {
  return decodeEntities(String(s).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}
export function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return !Number.isInteger(code) || code < 0 || code > 0x10ffff ? m : String.fromCodePoint(code); }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”' }[e.toLowerCase()] ?? m;
  });
}

export async function fetchPage(url, { maxChars = 12000 } = {}) {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,text/plain,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`fetch failed: HTTP ${res.status}`);
  const type = res.headers.get('content-type') || '';
  const body = await res.text();
  const text = type.includes('html') ? htmlToText(body) : body;
  const title = (body.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [, ''])[1];
  return { url: res.url || url, title: clean(title), text: text.slice(0, maxChars), truncated: text.length > maxChars };
}
export function htmlToText(html) {
  let t = html.replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, ' ');
  t = t.replace(/<!--[\s\S]*?-->/g, ' ');
  t = t.replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)[^>]*>/gi, '\n');
  t = t.replace(/<li[^>]*>/gi, '\n- ');
  t = t.replace(/<h([1-6])[^>]*>/gi, (m, n) => '\n' + '#'.repeat(Number(n)) + ' ');
  t = t.replace(/<[^>]+>/g, ' ');
  t = decodeEntities(t);
  return t.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
}

export const SETUP_OPTIONS = `Web research options (all free):
  1. Native tool web search  - Claude Code, Codex, Gemini CLI and Cursor can browse on their own. Nothing to install.
  2. Built-in CLI (no keys)  - product-planner research search "<query>" / research fetch <url>
                               Uses DuckDuckGo's HTML endpoint. Works from any agent that can run a shell command.
  3. MCP servers (optional)  - uvx mcp-server-fetch (page fetching; requires uv)
                               https://github.com/modelcontextprotocol/servers/tree/main/src/fetch
                               For search integrations, verify provider terms and current client setup first.
  4. Self-hosted             - SearXNG (docker run -p 8080:8080 searxng/searxng) for heavy research.
Run 'product-planner doctor' to confirm this machine has outbound web access.`;
