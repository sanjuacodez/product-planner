import path from 'node:path';
import fs from 'node:fs';
import { STATE_DIR, readJson, writeJson, readText, writeText, nowIso, exists } from './util/fs.js';

export const PHASES = ['init', 'planning', 'build', 'done'];
export const PLANNING_STEPS = ['setup', 'concept', 'research', 'prd', 'ux', 'marketing', 'architecture', 'tasks', 'handoff'];

export function stateDir(cwd = process.cwd()) { return path.join(cwd, STATE_DIR); }
export function statePath(cwd) { return path.join(stateDir(cwd), 'state.json'); }
export function configPath(cwd) { return path.join(stateDir(cwd), 'config.json'); }
export function logPath(cwd) { return path.join(stateDir(cwd), 'log.jsonl'); }

export function defaultState() {
  return {
    version: 1,
    product: { name: '', tagline: '', summary: '' },
    phase: 'init',
    planning: Object.fromEntries(PLANNING_STEPS.map((s) => [s, 'pending'])),
    options: {
      track: 'standard',
      research: true,
      marketing: false,
      memory: false,
      webAccess: 'unknown',
      commitPerTask: true,
      autoOpenDashboard: true,
    },
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}
export function defaultConfig() {
  return {
    version: 1,
    tools: [],
    autoRun: true,
    dashboard: { output: 'product-dashboard.html', autoRefreshSeconds: 30, title: '' },
    research: { engine: 'duckduckgo', maxResults: 8 },
    memory: { backend: 'auto', include: ['.product-planner/**/*.md', 'docs/**/*.md', 'README.md'] },
  };
}

export function loadState(cwd) {
  const s = readJson(statePath(cwd));
  if (!s) throw new Error('not initialised: run `product-planner init` first');
  return s;
}
export function saveState(cwd, s) { s.updatedAt = nowIso(); writeJson(statePath(cwd), s); return s; }
export function loadConfig(cwd) { return { ...defaultConfig(), ...(readJson(configPath(cwd)) || {}) }; }
export function isInitialised(cwd) { return exists(statePath(cwd)); }

export function setByPath(obj, dotted, value) {
  const keys = dotted.split('.');
  if (keys.some((k) => !k || ['__proto__', 'constructor', 'prototype'].includes(k))) throw new Error('invalid state path');
  let cur = obj;
  for (const k of keys.slice(0, -1)) { if (typeof cur[k] !== 'object' || cur[k] == null) cur[k] = {}; cur = cur[k]; }
  cur[keys.at(-1)] = coerce(value);
  return obj;
}
export function coerce(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v !== '' && !Number.isNaN(Number(v))) return Number(v);
  if (typeof v === 'string' && /^[[{]/.test(v)) { try { return JSON.parse(v); } catch { /* keep string */ } }
  return v;
}

export function appendLog(cwd, entry) {
  const line = JSON.stringify({ ts: nowIso(), ...entry });
  const p = logPath(cwd);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, line + '\n');
}
export function readLog(cwd) {
  const t = readText(logPath(cwd), '');
  return t.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
