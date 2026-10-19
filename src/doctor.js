import { spawnSync } from 'node:child_process';
import { isInitialised, loadConfig, loadState } from './state.js';
import { memoryStatus } from './memory/index.js';

export async function doctor(cwd) {
  const checks = [];
  const nodeOk = Number(process.versions.node.split('.')[0]) >= 20;
  checks.push({ name: 'node', ok: nodeOk, detail: `v${process.versions.node}${nodeOk ? '' : ' (need >= 20)'}` });
  const git = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd, encoding: 'utf8' });
  checks.push({ name: 'git repo', ok: git.status === 0, detail: git.status === 0 ? 'yes' : 'not a git repo (run git init so planning docs are versioned)' });
  const init = isInitialised(cwd);
  checks.push({ name: 'initialised', ok: init, detail: init ? `tools: ${loadConfig(cwd).tools.join(', ')} · phase: ${loadState(cwd).phase}` : 'run product-planner init' });
  let web = false, webDetail = '';
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch('https://html.duckduckgo.com/html/?q=ping', { method: 'HEAD', signal: ctrl.signal }); clearTimeout(t);
    web = r.ok; webDetail = `HTTP ${r.status}`;
  } catch (e) { webDetail = e.name === 'AbortError' ? 'timeout' : e.message; }
  checks.push({ name: 'web access', ok: web, detail: web ? `reachable (${webDetail}) – research CLI will work` : `unreachable (${webDetail}) – research must use the tool's own browser or user-provided material` });
  if (init) { const m = memoryStatus(cwd); checks.push({ name: 'memory', ok: true, detail: m.indexed ? `${m.backend}, ${m.chunks} chunks from ${m.files} files` : `not indexed (optional) – vector libs ${m.vectorAvailable ? 'installed' : 'not installed'}` }); }
  return checks;
}
