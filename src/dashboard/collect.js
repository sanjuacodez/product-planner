import path from 'node:path';
import { stateDir, loadState, loadConfig, readLog, PLANNING_STEPS } from '../state.js';
import { loadTasks, summary, tasksByEpic } from '../tasks.js';
import { readText, readJson, listFiles } from '../util/fs.js';

const DOCS = [
  ['concept', 'Product concept', 'concept.md'],
  ['prd', 'Product requirements (PRD)', 'prd.md'],
  ['ux', 'UX and UI direction', 'ux.md'],
  ['marketing', 'Marketing plan', 'marketing.md'],
  ['architecture', 'Architecture', 'architecture.md'],
  ['market', 'Market research', path.join('research', 'market.md')],
];

export function collect(cwd = process.cwd()) {
  const dir = stateDir(cwd);
  const state = loadState(cwd);
  const config = loadConfig(cwd);
  const tasks = loadTasks(cwd);
  const log = readLog(cwd);
  const docs = DOCS.map(([key, title, file]) => ({ key, title, file, text: readText(path.join(dir, file)) })).filter((d) => d.text);
  const custom = listFiles(path.join(dir, 'dashboard'), (f) => f.endsWith('.json'))
    .map((f) => { try { return { file: path.basename(f), ...readJson(f) }; } catch (e) { return { file: path.basename(f), title: path.basename(f), type: 'text', text: `Invalid JSON: ${e.message}` }; } })
    .sort((a, b) => (a.order ?? 50) - (b.order ?? 50) || a.file.localeCompare(b.file));
  return {
    generatedAt: new Date().toISOString(),
    state, config, tasks, log,
    summary: summary(tasks),
    byEpic: tasksByEpic(tasks),
    planningSteps: PLANNING_STEPS.map((s) => ({ step: s, status: state.planning?.[s] || 'pending' })),
    docs,
    roadmap: readText(path.join(dir, 'roadmap.md')),
    risks: readText(path.join(dir, 'risks.md')),
    decisions: readText(path.join(dir, 'decisions.md')),
    competitors: readJson(path.join(dir, 'research', 'competitors.json'), null),
    custom,
    burnup: burnupSeries(log, tasks),
  };
}

/** Daily cumulative done vs total scope, derived from the log. */
export function burnupSeries(log, tasks) {
  const events = log.filter((e) => e.type === 'task' && e.task && e.ts).sort((a, b) => a.ts.localeCompare(b.ts));
  if (!events.length) return [];
  const days = new Map();
  const day = (ts) => ts.slice(0, 10);
  let scope = 0, done = 0;
  const doneSet = new Set();
  const seen = new Set();
  for (const e of events) {
    if (!seen.has(e.task)) { seen.add(e.task); scope++; }
    if (e.to === 'done' && !doneSet.has(e.task)) { doneSet.add(e.task); done++; }
    if (e.from === 'done' && e.to !== 'done' && doneSet.has(e.task)) { doneSet.delete(e.task); done--; }
    days.set(day(e.ts), { date: day(e.ts), scope, done });
  }
  const total = tasks.tasks.length;
  const series = [...days.values()];
  const last = series.at(-1);
  const todayStr = day(new Date().toISOString());
  if (last.date !== todayStr) series.push({ date: todayStr, scope: Math.max(total, last.scope), done: tasks.tasks.filter((t) => t.status === 'done').length });
  else { last.scope = Math.max(total, last.scope); last.done = tasks.tasks.filter((t) => t.status === 'done').length; }
  return series;
}
