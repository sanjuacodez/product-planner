/** Transcript-derived usage. Unbound concurrent work is explicitly estimated, never billed per-task cost. */
import path from 'node:path';
import fs from 'node:fs';
import { stateDir, loadState } from './state.js';
import { loadTasks } from './tasks.js';
import { readJson, writeJson, nowIso } from './util/fs.js';
import { costOf } from './pricing.js';

// cacheWrite1h is the part of cacheWrite written with the 1-hour TTL (priced higher); it is not added to totals.
const SUMMED = ['input', 'cacheWrite', 'cacheRead', 'output'];
const KEYS = [...SUMMED, 'cacheWrite1h'];
const zero = () => Object.fromEntries(KEYS.map((k) => [k, 0]));
const add = (a, b) => { for (const k of KEYS) a[k] += b[k] || 0; return a; };
export const usagePath = (cwd) => path.join(stateDir(cwd), 'usage.jsonl');
const snapshotPath = (cwd) => path.join(stateDir(cwd), 'usage-state.json');
const bindingsPath = (cwd) => path.join(stateDir(cwd), 'usage-bindings.json');

export function bindUsage(cwd, file, id) {
  if (!loadTasks(cwd).tasks.some((t) => t.id === id)) throw new Error(`unknown task ${id}`);
  if (!file) throw new Error('worker transcript file required');
  const bindings = readJson(bindingsPath(cwd), {});
  bindings[path.resolve(file)] = id; writeJson(bindingsPath(cwd), bindings);
  return { file: path.resolve(file), task: id };
}
/** De-duplicate message updates before summing. Preserve every model and transcript stream. */
export function transcriptTotals(transcriptPath, bindings = {}) {
  const files = [transcriptPath];
  const sub = path.join(transcriptPath.replace(/\.jsonl$/, ''), 'subagents');
  if (fs.existsSync(sub)) for (const f of fs.readdirSync(sub).sort()) if (f.endsWith('.jsonl')) files.push(path.join(sub, f));
  const messages = new Map();
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    let lineNo = 0;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      lineNo++;
      let e; try { e = JSON.parse(line); } catch { continue; }
      if (e.type !== 'assistant' || !e.message?.usage) continue;
      messages.set(e.message.id || `${file}:${lineNo}`, { file, model: e.message.model || 'unknown', usage: e.message.usage });
    }
  }
  const groups = new Map();
  for (const { file, model, usage: u } of messages.values()) {
    const key = JSON.stringify([file, model]);
    if (!groups.has(key)) groups.set(key, { key, file, model, task: bindings[path.resolve(file)], tokens: zero() });
    add(groups.get(key).tokens, { input: u.input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0, cacheWrite1h: u.cache_creation?.ephemeral_1h_input_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, output: u.output_tokens || 0 });
  }
  const streams = [...groups.values()], tokens = zero(), byModel = {};
  for (const s of streams) { add(tokens, s.tokens); add(byModel[s.model] ??= zero(), s.tokens); }
  return { tokens, streams, byModel, model: Object.keys(byModel).length === 1 ? Object.keys(byModel)[0] : 'mixed' };
}

export function snapshot(cwd, { sessionId, transcriptPath }) {
  if (!sessionId || !transcriptPath || !fs.existsSync(transcriptPath)) return null;
  const phase = loadState(cwd).phase;
  const snap = readJson(snapshotPath(cwd), { sessions: {} });
  const saved = snap.sessions[sessionId];
  const tasks = loadTasks(cwd).tasks;
  const activeNow = tasks.filter((t) => ['in_progress', 'review'].includes(t.status));
  const previous = saved?.streams ? saved : { streams: {}, active: snap.active || [], phase: snap.phase || phase, stage: phase === 'build' ? 'build' : 'planning' };
  const totals = transcriptTotals(transcriptPath, readJson(bindingsPath(cwd), {}));
  // Migrate aggregate snapshots without counting already-recorded tokens a second time.
  const legacyRemaining = saved && !saved.streams ? { ...saved } : zero();
  const entries = [];
  for (const stream of totals.streams) {
    const prev = previous.streams[stream.key] || zero();
    const delta = {};
    for (const k of KEYS) {
      const value = Math.max(0, stream.tokens[k] - (prev[k] || 0));
      const consumed = Math.min(value, legacyRemaining[k] || 0);
      delta[k] = value - consumed; legacyRemaining[k] = (legacyRemaining[k] || 0) - consumed;
    }
    if (!KEYS.some((k) => delta[k])) continue;
    const attributed = stream.task ? [stream.task] : previous.active;
    const entry = { ts: nowIso(), session: sessionId, model: stream.model, transcript: stream.file, source: 'claude-transcript', tokens: delta, stage: previous.stage || 'planning', attribution: stream.task ? 'bound' : attributed.length ? 'estimated' : 'phase', ...(attributed.length ? { tasks: attributed } : { phase: previous.phase }) };
    fs.appendFileSync(usagePath(cwd), JSON.stringify(entry) + '\n'); entries.push(entry);
  }
  snap.sessions[sessionId] = { streams: Object.fromEntries(totals.streams.map((s) => [s.key, s.tokens])), active: activeNow.map((t) => t.id), phase, stage: phase !== 'build' ? 'planning' : activeNow.length && activeNow.every((t) => t.status === 'review') ? 'qa' : 'build' };
  delete snap.active; delete snap.phase;
  writeJson(snapshotPath(cwd), snap);
  return entries;
}
export function runHook(cwd, input) {
  let h; try { h = JSON.parse(input || '{}'); } catch { return null; }
  if (h.hook_event_name === 'PostToolUse' && !/\b(product-planner|pp)\s+(task|state)\b/.test(String(h.tool_input?.command || ''))) return null;
  let transcriptPath = h.transcript_path || '';
  const m = transcriptPath.match(/^(.*)[\\/]subagents[\\/][^\\/]+$/);
  if (m) transcriptPath = `${m[1]}.jsonl`;
  return snapshot(h.cwd || cwd, { sessionId: h.session_id, transcriptPath });
}
export function readUsage(cwd) {
  if (!fs.existsSync(usagePath(cwd))) return [];
  return fs.readFileSync(usagePath(cwd), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
export function summarizeUsage(entries, { prices } = {}) {
  const total = zero(), byTask = {}, byPhase = {}, byModel = {}, byStage = {}, byAttribution = {};
  // Estimated USD alongside tokens; tokens from models without a known price are counted, not guessed.
  const cost = { total: 0, byTask: {}, byPhase: {}, byModel: {}, byStage: {}, unpricedTokens: 0, unpricedModels: [] };
  const taskModels = {};
  const all = (t) => SUMMED.reduce((a, k) => a + (t[k] || 0), 0);
  for (const e of entries) {
    add(total, e.tokens);
    const model = e.model || 'unknown';
    const usd = costOf(e.tokens, model, prices);
    if (usd == null) { cost.unpricedTokens += all(e.tokens); if (!cost.unpricedModels.includes(model)) cost.unpricedModels.push(model); }
    const spend = (bucket, key, share = 1) => { if (usd != null) bucket[key] = (bucket[key] || 0) + usd * share; };
    if (usd != null) cost.total += usd;
    const ids = [...new Set(e.tasks || [])].sort();
    // Distribute integer remainders deterministically so task totals conserve measured tokens.
    if (ids.length) for (let i = 0; i < ids.length; i++) {
      const allocation = Object.fromEntries(KEYS.map((k) => { const value = e.tokens[k] || 0; return [k, Math.floor(value / ids.length) + (i < value % ids.length ? 1 : 0)]; }));
      add(byTask[ids[i]] ??= zero(), allocation);
      spend(cost.byTask, ids[i], 1 / ids.length);
      (taskModels[ids[i]] ??= new Set()).add(model);
    } else { add(byPhase[e.phase || 'other'] ??= zero(), e.tokens); spend(cost.byPhase, e.phase || 'other'); }
    add(byModel[model] ??= zero(), e.tokens); spend(cost.byModel, model);
    add(byStage[e.stage || 'unknown'] ??= zero(), e.tokens); spend(cost.byStage, e.stage || 'unknown');
    add(byAttribution[e.attribution || (ids.length ? 'estimated' : 'phase')] ??= zero(), e.tokens);
  }
  return { total, all: all(total), byTask, byPhase, byModel, byStage, byAttribution, cost, taskModels: Object.fromEntries(Object.entries(taskModels).map(([k, v]) => [k, [...v].sort()])), tracking: { automatic: ['Claude Code transcripts'], unsupported: 'Other hosts have no automatic usage collector; missing data is not zero usage.', taskAllocation: 'Unbound task attribution is estimated; bind a worker transcript for direct attribution.' }, sum: all };
}
