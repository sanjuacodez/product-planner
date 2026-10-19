/**
 * Browser access for research and UI QA. The host tool's own browser is always preferred; this module
 * only reports what is available and, after the user approves it during planning, installs the free
 * open-source Playwright MCP server (Apache-2.0) with a matching Chromium and registers it with the
 * project's AI tools.
 */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { readJson, writeJson, exists, nowIso } from '../util/fs.js';
import { loadConfig, loadState, saveState, appendLog } from '../state.js';

export const SERVER_NAME = 'playwright';
export const PACKAGE = '@playwright/mcp';
export const ENGINES = ['chromium', 'firefox', 'webkit'];
const BROWSER_KEY = /playwright|chrome-devtools|browser|puppeteer/i;

export const BROWSER_OPTIONS = `Browser access options, in order of preference:
  1. The AI tool's own browser   Use it when the host exposes one (built-in browser, browser preview,
                                 browser extension, or an already-configured browser MCP server).
                                 Nothing to install. Record it: product-planner browser use host --detail "…"
  2. Playwright MCP + Chromium   Free and open source (Apache-2.0, maintained by Microsoft). Install only
                                 after the user approves it:  product-planner browser setup
                                 Downloads the MCP package via npx and a Chromium build (~150 MB) into the
                                 shared Playwright cache, then registers the server for this project's tools.
  3. No interactive browser      Research uses: product-planner research search|fetch (HTML/text only).
                                 UI QA records what could not be verified.  product-planner browser use none
Run 'product-planner browser status' to see what is configured on this machine.`;

/** Where each tool reads project-scoped MCP servers. `manual` tools only get printed instructions. */
export const TARGETS = {
  claude: { file: '.mcp.json', key: 'mcpServers', shape: 'std' },
  cursor: { file: path.join('.cursor', 'mcp.json'), key: 'mcpServers', shape: 'std' },
  gemini: { file: path.join('.gemini', 'settings.json'), key: 'mcpServers', shape: 'std' },
  vscode: { file: path.join('.vscode', 'mcp.json'), key: 'servers', shape: 'std' },
  opencode: { file: 'opencode.json', key: 'mcp', shape: 'opencode' },
  codex: { manual: (cmd) => `codex mcp add ${SERVER_NAME} -- ${cmd.join(' ')}` },
  windsurf: { manual: (cmd) => `Add to ~/.codeium/windsurf/mcp_config.json:\n    { "mcpServers": { "${SERVER_NAME}": ${JSON.stringify({ command: cmd[0], args: cmd.slice(1) })} } }` },
  generic: { manual: (cmd) => `Register an MCP server named "${SERVER_NAME}" in your tool, command: ${cmd.join(' ')}` },
};

export function serverCommand(version, { engine = 'chromium', headless = false } = {}) {
  return ['npx', '-y', `${PACKAGE}@${version}`, '--browser', engine, ...(headless ? ['--headless'] : [])];
}
function entryFor(shape, cmd) {
  return shape === 'opencode' ? { type: 'local', command: cmd, enabled: true } : { command: cmd[0], args: cmd.slice(1) };
}

/** Add the server to every selected tool's project config. Existing entries are kept unless force is set. */
export function registerServer(cwd, tools, cmd, { force = false } = {}) {
  const results = [];
  for (const tool of new Set(tools)) {
    const t = TARGETS[tool];
    if (!t) { results.push({ tool, action: 'skipped', detail: 'no MCP target for this tool' }); continue; }
    if (t.manual) { results.push({ tool, action: 'manual', detail: t.manual(cmd) }); continue; }
    const file = path.join(cwd, t.file);
    const json = readJson(file, {}) || {};
    if (tool === 'opencode' && !exists(file) && exists(path.join(cwd, 'opencode.jsonc'))) { results.push({ tool, action: 'manual', detail: `opencode.jsonc exists; add "mcp": { "${SERVER_NAME}": ${JSON.stringify(entryFor('opencode', cmd))} }` }); continue; }
    json[t.key] ??= {};
    if (json[t.key][SERVER_NAME] && !force) { results.push({ tool, action: 'kept', file: t.file, detail: 'a playwright server is already configured (use --force to replace)' }); continue; }
    if (tool === 'opencode') json.$schema ??= 'https://opencode.ai/config.json';
    json[t.key][SERVER_NAME] = entryFor(t.shape, cmd);
    writeJson(file, json);
    results.push({ tool, action: 'written', file: t.file });
  }
  return results;
}

export function unregisterServer(cwd) {
  const removed = [];
  for (const t of Object.values(TARGETS)) {
    if (t.manual) continue;
    const file = path.join(cwd, t.file);
    const json = exists(file) ? readJson(file, null) : null;
    if (!json?.[t.key]?.[SERVER_NAME]) continue;
    delete json[t.key][SERVER_NAME];
    writeJson(file, json);
    removed.push(t.file);
  }
  return removed;
}

export function playwrightCacheDir() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return process.env.PLAYWRIGHT_BROWSERS_PATH;
  const home = os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Caches', 'ms-playwright');
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'ms-playwright');
  return path.join(home, '.cache', 'ms-playwright');
}

function systemBrowsers() {
  const found = [];
  if (process.platform === 'darwin') {
    for (const app of ['Google Chrome', 'Chromium', 'Firefox', 'Microsoft Edge', 'Brave Browser', 'Safari']) if (exists(`/Applications/${app}.app`)) found.push(app);
  } else {
    const dirs = (process.env.PATH || '').split(path.delimiter);
    for (const bin of ['chromium', 'chromium-browser', 'google-chrome', 'firefox', 'microsoft-edge', 'chrome.exe', 'msedge.exe', 'firefox.exe']) if (dirs.some((d) => d && exists(path.join(d, bin)))) found.push(bin);
  }
  return found;
}

/** Report configured browser MCP servers, cached Playwright browsers, installed browsers and the recorded choice. */
export function browserStatus(cwd) {
  const servers = [];
  for (const [tool, t] of Object.entries(TARGETS)) {
    if (t.manual) continue;
    let json = null; try { json = readJson(path.join(cwd, t.file), null); } catch { /* unreadable config is reported as absent */ }
    for (const name of Object.keys(json?.[t.key] || {})) if (BROWSER_KEY.test(name) || BROWSER_KEY.test(JSON.stringify(json[t.key][name]))) servers.push({ tool, file: t.file, name });
  }
  const cache = playwrightCacheDir();
  const cached = exists(cache) ? fs.readdirSync(cache).filter((d) => /^(chromium|firefox|webkit)/.test(d)) : [];
  let choice = null; try { choice = loadState(cwd).options?.browser || null; } catch { /* not initialised */ }
  return { choice, servers, playwrightCache: cache, cachedBrowsers: cached, systemBrowsers: systemBrowsers() };
}

export function recordChoice(cwd, browser) {
  const st = loadState(cwd);
  st.options.browser = { ...browser, recordedAt: nowIso() };
  saveState(cwd, st);
  appendLog(cwd, { type: 'note', message: `Browser access: ${browser.source}${browser.detail ? ` (${browser.detail})` : ''}` });
  return st.options.browser;
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: opts.capture ? 'pipe' : 'inherit', encoding: 'utf8', shell: process.platform === 'win32' });
  if (r.error) throw new Error(`${cmd} failed: ${r.error.message}`);
  return r;
}

/**
 * Approved setup: pin one @playwright/mcp version, install the browser build that version expects,
 * then register that same pinned server with the selected tools.
 */
export function setupBrowser(cwd, { tools, engine = 'chromium', headless = false, version, skipInstall = false, force = false } = {}) {
  if (!ENGINES.includes(engine)) throw new Error(`engine must be one of ${ENGINES.join(', ')}`);
  let pinned = version;
  if (!pinned) {
    const r = run('npm', ['view', PACKAGE, 'version'], { capture: true });
    pinned = r.status === 0 ? r.stdout.trim() : '';
    if (!pinned) throw new Error(`could not resolve the ${PACKAGE} version (npm view failed: ${(r.stderr || '').trim().split('\n')[0]}). Pass --version x.y.z`);
  }
  if (!skipInstall) {
    console.log(`Installing Playwright's ${engine} build for ${PACKAGE}@${pinned} into ${playwrightCacheDir()}.\nPlaywright may warn that project dependencies are not installed; that is expected because the browser belongs to the MCP server, not your product.`);
    const r = run('npx', ['-y', '-p', `${PACKAGE}@${pinned}`, 'playwright', 'install', engine]);
    if (r.status !== 0) throw new Error(`browser download failed (exit ${r.status}). On Linux, system libraries may be missing: npx -y -p ${PACKAGE}@${pinned} playwright install-deps ${engine}`);
  }
  const cmd = serverCommand(pinned, { engine, headless });
  const selected = tools?.length ? tools : loadConfig(cwd).tools;
  const results = registerServer(cwd, selected, cmd, { force });
  recordChoice(cwd, { source: 'playwright-mcp', engine, package: `${PACKAGE}@${pinned}`, headless, tools: selected });
  return { version: pinned, cmd, results };
}
