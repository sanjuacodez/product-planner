import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { collect } from './collect.js';
import { renderDashboard } from './render.js';
import { loadConfig, stateDir } from '../state.js';
import { writeText } from '../util/fs.js';

export function buildDashboard(cwd = process.cwd()) {
  const config = loadConfig(cwd);
  const out = path.resolve(cwd, config.dashboard?.output || 'product-dashboard.html');
  const html = renderDashboard(collect(cwd));
  writeText(out, html);
  return out;
}

export function openInBrowser(file) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', file] : [file];
  try { const child = spawn(cmd, args, { detached: true, stdio: 'ignore' }); child.on('error', (err) => console.error(`could not open dashboard: ${err.message}`)); child.unref(); return true; } catch { return false; }
}

export function watchDashboard(cwd, onBuild) {
  const dir = stateDir(cwd);
  let timer = null;
  const rebuild = () => { clearTimeout(timer); timer = setTimeout(() => { try { onBuild(buildDashboard(cwd)); } catch (e) { console.error(`dashboard: ${e.message}`); } }, 300); };
  fs.watch(dir, { recursive: true }, (_evt, name) => { if (name && !String(name).includes('node_modules')) rebuild(); });
  rebuild();
}
