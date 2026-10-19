import path from 'node:path';
import { stateDir, appendLog } from './state.js';
import { readJson, writeJson, nowIso } from './util/fs.js';

export const STATUSES = ['todo', 'in_progress', 'review', 'done', 'blocked'];
const PRIORITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };

export function tasksPath(cwd) { return path.join(stateDir(cwd), 'tasks.json'); }
export function emptyTasks() { return { version: 1, epics: [], tasks: [] }; }
export function loadTasks(cwd) { return normalise(readJson(tasksPath(cwd), emptyTasks())); }
export function saveTasks(cwd, t) { writeJson(tasksPath(cwd), normalise(t)); return t; }

export function normalise(t) {
  t.version ??= 1; t.epics ??= []; t.tasks ??= [];
  for (const task of t.tasks) {
    task.status ??= 'todo';
    task.priority ??= 'medium';
    task.dependsOn ??= [];
    task.acceptance ??= [];
    task.notes ??= [];
    task.agent ??= 'developer';
    task.workedBy ??= [];
  }
  return t;
}

export function validateTasks(t) {
  const errors = [];
  if (!t || !Array.isArray(t.epics) || !Array.isArray(t.tasks)) return ['plan must contain epics and tasks arrays'];
  const ids = new Set();
  const epicIds = new Set(t.epics.map((e) => e.id));
  if (epicIds.size !== t.epics.length) errors.push('duplicate epic id');
  for (const epic of t.epics) {
    if (!/^E[1-9]\d*$/.test(epic.id)) errors.push(`invalid epic id ${epic.id}`);
    if (!epic.title) errors.push(`${epic.id}: missing title`);
  }
  for (const task of t.tasks) {
    if (!/^T[1-9]\d*$/.test(task.id)) errors.push(`invalid task id ${task.id}`);
    if (!task.id) errors.push(`task without id: ${JSON.stringify(task).slice(0, 60)}`);
    if (ids.has(task.id)) errors.push(`duplicate task id ${task.id}`);
    ids.add(task.id);
    if (!task.title) errors.push(`${task.id}: missing title`);
    if (!STATUSES.includes(task.status ?? 'todo')) errors.push(`${task.id}: invalid status ${task.status}`);
    if (!Object.hasOwn(PRIORITY_RANK, task.priority ?? 'medium')) errors.push(`${task.id}: invalid priority ${task.priority}`);
    if (task.estimate && !['S', 'M', 'L'].includes(task.estimate)) errors.push(`${task.id}: invalid estimate ${task.estimate}`);
    if (task.dependsOn != null && !Array.isArray(task.dependsOn)) errors.push(`${task.id}: dependsOn must be an array`);
    if (task.features != null && (!Array.isArray(task.features) || task.features.some((x) => typeof x !== 'string'))) errors.push(`${task.id}: features must be an array of feature ids`);
    if (task.risk != null && !['low', 'medium', 'high'].includes(task.risk)) errors.push(`${task.id}: risk must be low, medium or high`);
    if (task.model != null && typeof task.model !== 'string') errors.push(`${task.id}: model must be a string`);
    if (task.epic && !epicIds.has(task.epic)) errors.push(`${task.id}: unknown epic ${task.epic}`);
    if (!Array.isArray(task.acceptance) || !task.acceptance.length || task.acceptance.some((a) => typeof a !== 'string' || !a.trim())) errors.push(`${task.id}: acceptance must contain nonempty criteria`);
  }
  if (errors.length) return errors;
  for (const task of t.tasks) for (const d of task.dependsOn || []) if (!ids.has(d)) errors.push(`${task.id}: unknown dependency ${d}`);
  const cyc = findCycle(t.tasks);
  if (cyc) errors.push(`dependency cycle: ${cyc.join(' -> ')}`);
  return errors;
}
function findCycle(tasks) {
  const map = new Map(tasks.map((t) => [t.id, t.dependsOn || []]));
  const state = new Map();
  const stack = [];
  const visit = (id) => {
    if (state.get(id) === 1) return [...stack.slice(stack.indexOf(id)), id];
    if (state.get(id) === 2) return null;
    state.set(id, 1); stack.push(id);
    for (const d of map.get(id) || []) { const r = visit(d); if (r) return r; }
    stack.pop(); state.set(id, 2);
    return null;
  };
  for (const id of map.keys()) { const r = visit(id); if (r) return r; }
  return null;
}

export function getTask(t, id) {
  const task = t.tasks.find((x) => x.id === id);
  if (!task) throw new Error(`unknown task ${id}`);
  return task;
}
export function isReady(t, task) {
  if (task.status !== 'todo') return false;
  return task.dependsOn.every((d) => t.tasks.find((x) => x.id === d)?.status === 'done');
}
export function readyTasks(t) {
  const epicOrder = new Map(t.epics.map((e, i) => [e.id, e.order ?? i]));
  return t.tasks.filter((task) => isReady(t, task)).sort((a, b) =>
    (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) ||
    (epicOrder.get(a.epic) ?? 99) - (epicOrder.get(b.epic) ?? 99) ||
    natural(a.id, b.id));
}
export function nextTask(t) { return readyTasks(t)[0] || null; }
export function natural(a, b) { return String(a).localeCompare(String(b), undefined, { numeric: true }); }

export function summary(t) {
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const task of t.tasks) counts[task.status] = (counts[task.status] || 0) + 1;
  const total = t.tasks.length;
  const ready = readyTasks(t).length;
  const pct = total ? Math.round((counts.done / total) * 100) : 0;
  return { total, ...counts, ready, pct };
}

export function transition(cwd, id, status, extra = {}) {
  const t = loadTasks(cwd);
  const task = getTask(t, id);
  const from = task.status;
  const allowed = { todo: ['in_progress', 'blocked'], in_progress: ['review', 'blocked', 'todo'], review: ['done', 'in_progress', 'blocked', 'todo'], done: ['todo'], blocked: ['todo'] };
  if (!allowed[from]?.includes(status)) throw new Error(`cannot move ${id} from ${from} to ${status}`);
  if (status === 'in_progress' && task.dependsOn.some((d) => getTask(t, d).status !== 'done')) throw new Error(`${id}: dependencies are not done`);
  if (status === 'blocked' && !extra.reason?.trim()) throw new Error('blocking requires a reason');
  if (from === 'review' && status === 'in_progress') task.qaReturns = (task.qaReturns || 0) + 1;
  task.status = status;
  if (status !== 'done') delete task.completedAt;
  if (status === 'in_progress') { task.startedAt ??= nowIso(); delete task.blockedReason; }
  if (status === 'done') { task.completedAt = nowIso(); delete task.blockedReason; }
  if (status === 'blocked') task.blockedReason = extra.reason || 'unspecified';
  if (status === 'todo') { delete task.blockedReason; }
  const agent = agentName(extra.agent);
  if (agent || extra.model) recordWorker(task, agent || task.agent, extra.model);
  if (extra.note) task.notes.push({ ts: nowIso(), text: extra.note, agent, model: extra.model });
  saveTasks(cwd, t);
  appendLog(cwd, { type: 'task', task: id, from, to: status, agent, model: extra.model, note: extra.note || extra.reason });
  return task;
}

/** Persona names are stored without the pp- prefix used by installed agent files. */
export function agentName(agent) { return agent ? String(agent).trim().replace(/^pp-/, '') : undefined; }

/** Remember which agent persona and AI model actually worked on a task. */
export function recordWorker(task, agent, model) {
  const existing = task.workedBy.find((w) => w.agent === agent && (!model || !w.model || w.model === model));
  if (existing) { if (model) existing.model = model; existing.ts = nowIso(); }
  else task.workedBy.push({ agent, ...(model ? { model } : {}), ts: nowIso() });
}

export function addTask(cwd, task) {
  const t = loadTasks(cwd);
  if (!task.id) task.id = nextId(t.tasks, 'T');
  if (t.tasks.some((x) => x.id === task.id)) throw new Error(`task ${task.id} already exists`);
  t.tasks.push(task);
  normalise(t);
  const errors = validateTasks(t);
  if (errors.length) throw new Error(errors.join('; '));
  saveTasks(cwd, t);
  appendLog(cwd, { type: 'task', task: task.id, from: null, to: task.status, note: `added: ${task.title}` });
  return task;
}
const EDITABLE = ['title', 'description', 'acceptance', 'epic', 'agent', 'model', 'priority', 'estimate', 'dependsOn', 'features', 'risk'];
export const LOOP_LIMIT = 3;

/** Replanning: revise a task that has not been completed. Done work is never rewritten; add a follow-up task instead. */
export function updateTask(cwd, id, changes, note) {
  const t = loadTasks(cwd);
  const task = getTask(t, id);
  if (task.status === 'done') throw new Error(`${id} is done; add a follow-up task instead of rewriting completed work`);
  const bad = Object.keys(changes).filter((k) => !EDITABLE.includes(k));
  if (bad.length) throw new Error(`cannot update ${bad.join(', ')} (editable: ${EDITABLE.join(', ')})`);
  const before = Object.fromEntries(Object.keys(changes).map((k) => [k, task[k]]));
  Object.assign(task, changes);
  normalise(t);
  const errors = validateTasks(t);
  if (errors.length) throw new Error(errors.join('; '));
  saveTasks(cwd, t);
  appendLog(cwd, { type: 'task', task: id, from: task.status, to: task.status, note: `updated ${Object.keys(changes).join(', ')}${note ? `: ${note}` : ''}`, changes: { before, after: changes } });
  return task;
}

/** Replanning: drop a task that never started. Dependents must be updated first. */
export function removeTask(cwd, id, reason) {
  if (!reason?.trim()) throw new Error('removing a task requires --reason');
  const t = loadTasks(cwd);
  const task = getTask(t, id);
  if (!['todo', 'blocked'].includes(task.status)) throw new Error(`${id} is ${task.status}; only todo or blocked tasks can be removed (finish or reopen it first)`);
  const dependents = t.tasks.filter((x) => x.dependsOn.includes(id)).map((x) => x.id);
  if (dependents.length) throw new Error(`${dependents.join(', ')} depend on ${id}; update their dependsOn first`);
  t.tasks = t.tasks.filter((x) => x.id !== id);
  saveTasks(cwd, t);
  appendLog(cwd, { type: 'task', task: id, from: task.status, to: 'removed', note: `removed: ${task.title} (${reason})` });
  return task;
}

export function nextId(items, prefix) {
  const nums = items.map((x) => Number(String(x.id).replace(/^\D+/, ''))).filter((n) => !Number.isNaN(n));
  return `${prefix}${(nums.length ? Math.max(...nums) : 0) + 1}`;
}
export function tasksByEpic(t) {
  const groups = new Map(t.epics.map((e) => [e.id, { epic: e, tasks: [] }]));
  const none = { epic: { id: '', title: 'Unassigned' }, tasks: [] };
  for (const task of t.tasks) (groups.get(task.epic) || none).tasks.push(task);
  const arr = [...groups.values()];
  if (none.tasks.length) arr.push(none);
  return arr;
}
