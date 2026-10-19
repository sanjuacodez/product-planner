/**
 * Token usage per task, from the host's own transcripts (Claude Code today).
 * A hook calls `product-planner usage hook` after each task/state command and when a response ends.
 * Tokens used since the previous snapshot are attributed to the tasks that were active in between,
 * or to the phase (planning/build) when no task was active.
 */
import path from 'node:path';
import fs from 'node:fs';
import { stateDir, loadState } from './state.js';
import { loadTasks } from './tasks.js';
import { readJson, writeJson, nowIso } from './util/fs.js';

const KEYS = ['input', 'cacheWrite', 'cacheRead', 'output'];
const zero = () => Object.fromEntries(KEYS.map((k) => [k, 0]));
export const usagePath = (cwd) => path.join(stateDir(cwd), 'usage.jsonl');
const snapshotPath = (cwd) => path.join(stateDir(cwd), 'usage-state.json');

/** Sum usage in a Claude Code transcript and its subagent transcripts, counting each API message once. */
export function transcriptTotals(transcriptPath) {
  const files = [transcriptPath];
  const sub = path.join(transcriptPath.replace(/\.jsonl$/, ''), 'subagents');
  if (fs.existsSync(sub)) for (const f of fs.readdirSync(sub)) if (f.endsWith('.jsonl')) files.push(path.join(sub, f));
  const byId = new Map(); const models = new Map();
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      if (!line.includes('"usage"')) continue;
      let e; try { e = JSON.parse(line); } catch { continue; }
      const u = e.message?.usage; if (e.type !== 'assistant' || !u) continue;
      byId.set(e.message.id || `${f}:${byId.size}`, u);
      if (e.message.model) models.set(e.message.model, (models.get(e.message.model) || 0) + 1);
    }
  }
  const t = zero();
  for (const u of byId.values()) { t.input += u.input_tokens || 0; t.cacheWrite += u.cache_creation_input_tokens || 0; t.cacheRead += u.cache_read_input_tokens || 0; t.output += u.output_tokens || 0; }
  return { tokens: t, model: [...models.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '' };
}

export function snapshot(cwd, { sessionId, transcriptPath }) {
  if (!sessionId || !transcriptPath || !fs.existsSync(transcriptPath)) return null;
  const currentPhase = () => { try { return loadState(cwd).phase; } catch { return 'planning'; } };
  const snap = readJson(snapshotPath(cwd), null) || { sessions: {}, active: [], phase: currentPhase() };
  const { tokens, model } = transcriptTotals(transcriptPath);
  const prev = snap.sessions[sessionId] || zero();
  const delta = Object.fromEntries(KEYS.map((k) => [k, Math.max(0, tokens[k] - (prev[k] || 0))]));
  const total = KEYS.reduce((a, k) => a + delta[k], 0);
  let entry = null;
  if (total > 0) {
    entry = { ts: nowIso(), session: sessionId, model, tokens: delta, ...(snap.active.length ? { tasks: snap.active } : { phase: snap.phase }) };
    fs.appendFileSync(usagePath(cwd), JSON.stringify(entry) + '\n');
  }
  const tasks = loadTasks(cwd).tasks;
  writeJson(snapshotPath(cwd), { sessions: { ...snap.sessions, [sessionId]: tokens }, active: tasks.filter((t) => ['in_progress', 'review'].includes(t.status)).map((t) => t.id), phase: currentPhase() });
  return entry;
}

/** Hook entry point: stdin is the host's hook JSON. Only task/state commands and response ends trigger a snapshot. */
export function runHook(cwd, input) {
  let h; try { h = JSON.parse(input || '{}'); } catch { return null; }
  if (h.hook_event_name === 'PostToolUse') {
    const cmd = String(h.tool_input?.command || '');
    if (!/\b(product-planner|pp)\s+(task|state)\b/.test(cmd)) return null;
  }
  // A subagent's transcript lives in <session>/subagents/; always total the parent session (which includes subagents).
  let transcriptPath = h.transcript_path || '';
  const m = transcriptPath.match(/^(.*)[\\/]subagents[\\/][^\\/]+$/);
  if (m) transcriptPath = `${m[1]}.jsonl`;
  return snapshot(h.cwd || cwd, { sessionId: h.session_id, transcriptPath });
}

export function readUsage(cwd) {
  if (!fs.existsSync(usagePath(cwd))) return [];
  return fs.readFileSync(usagePath(cwd), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

/** Totals overall, per phase bucket, per task (split evenly across concurrently active tasks) and per model. */
export function summarizeUsage(entries) {
  const sum = (a, b, f = 1) => { for (const k of KEYS) a[k] += Math.round((b[k] || 0) * f); return a; };
  const total = zero(); const byTask = {}; const byPhase = {}; const byModel = {};
  for (const e of entries) {
    sum(total, e.tokens);
    if (e.tasks?.length) for (const id of e.tasks) sum(byTask[id] ??= zero(), e.tokens, 1 / e.tasks.length);
    else sum(byPhase[e.phase || 'other'] ??= zero(), e.tokens);
    if (e.model) sum(byModel[e.model] ??= zero(), e.tokens);
  }
  const all = (t) => KEYS.reduce((a, k) => a + t[k], 0);
  return { total, all: all(total), byTask, byPhase, byModel, sum: all };
}
