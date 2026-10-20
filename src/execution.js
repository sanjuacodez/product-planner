import fs from 'node:fs';
import path from 'node:path';
import { loadState } from './state.js';
import { loadTasks, readyTasks, validateTasks } from './tasks.js';
import { projectPath } from './evidence.js';

function canonical(cwd, relative) {
  let full = projectPath(cwd, relative), suffix = [];
  while (!fs.existsSync(full)) { suffix.unshift(path.basename(full)); full = path.dirname(full); }
  return path.join(fs.realpathSync(full), ...suffix);
}
const overlaps = (a, b) => a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep);
function conflict(cwd, a, b) {
  const aw = (a.writes || []).map((p) => canonical(cwd, p));
  const bw = (b.writes || []).map((p) => canonical(cwd, p));
  const ar = (a.sources || []).map((p) => canonical(cwd, p));
  const br = (b.sources || []).map((p) => canonical(cwd, p));
  return aw.some((p) => [...bw, ...br].some((q) => overlaps(p, q))) || bw.some((p) => ar.some((q) => overlaps(p, q)));
}
const unsafe = (t) => !t.writes?.length || t.writes.some((p) => p === '.product-planner' || p.startsWith('.product-planner/'));
/** Read-only batch proposal; the coordinator reserves tasks sequentially before spawning. */
export function executionBatch(cwd) {
  const graph = loadTasks(cwd), errors = validateTasks(graph);
  if (errors.length) throw new Error(errors.join('; '));
  const cap = loadState(cwd).options?.maxConcurrentTasks ?? 2;
  if (!Number.isInteger(cap) || cap < 1) throw new Error('options.maxConcurrentTasks must be a positive integer');
  const active = graph.tasks.filter((t) => ['in_progress', 'review'].includes(t.status));
  const slots = Math.max(0, cap - active.length), selected = [], skipped = [];
  for (const task of readyTasks(graph)) {
    let reason;
    if (unsafe(task)) reason = 'Missing exclusive writes or shared planner outputs; run sequentially after ownership review.';
    else if (active.some(unsafe)) reason = 'An active task has unknown or shared ownership.';
    else if ([...active, ...selected].some((other) => conflict(cwd, task, other))) reason = 'Read/write ownership conflicts with active or selected work.';
    else if (selected.length >= slots) reason = 'Concurrency limit reached.';
    if (reason) skipped.push({ id: task.id, reason }); else selected.push(task);
  }
  return { maxConcurrentTasks: cap, active: active.map((t) => t.id), availableSlots: slots, tasks: selected, skipped, launchesWorkers: false };
}
