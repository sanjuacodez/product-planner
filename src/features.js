/**
 * Feature register: the agreed product scope, gathered during the planning interview.
 * Each accepted feature traces to tasks through task.features, so coverage can be checked.
 */
import path from 'node:path';
import { stateDir, appendLog } from './state.js';
import { readJson, writeJson } from './util/fs.js';

export const PRIORITIES = ['must', 'should', 'could', 'wont'];
export const FEATURE_STATUSES = ['proposed', 'accepted', 'deferred', 'rejected'];
export const RELEASES = ['MVP', 'Next', 'Later'];
const PRIORITY_RANK = Object.fromEntries(PRIORITIES.map((p, i) => [p, i]));

export function featuresPath(cwd) { return path.join(stateDir(cwd), 'features.json'); }
export function loadFeatures(cwd) { return normaliseFeatures(readJson(featuresPath(cwd), { version: 1, features: [] })); }
export function saveFeatures(cwd, f) { writeJson(featuresPath(cwd), normaliseFeatures(f)); return f; }

export function normaliseFeatures(f) {
  f.version ??= 1; f.features ??= [];
  for (const x of f.features) {
    x.priority ??= 'should';
    x.status ??= 'proposed';
    x.release ??= x.priority === 'must' ? 'MVP' : x.priority === 'wont' ? 'Later' : 'Next';
    x.acceptance ??= [];
    x.openQuestions ??= [];
    x.assumptions ??= [];
  }
  return f;
}

export function validateFeatures(f) {
  const errors = [];
  if (!f || !Array.isArray(f.features)) return ['features.json must contain a features array'];
  const ids = new Set();
  for (const x of f.features) {
    if (!/^F[1-9]\d*$/.test(x.id ?? '')) errors.push(`invalid feature id ${x.id}`);
    if (ids.has(x.id)) errors.push(`duplicate feature id ${x.id}`);
    ids.add(x.id);
    if (!x.title) errors.push(`${x.id}: missing title`);
    if (!PRIORITIES.includes(x.priority)) errors.push(`${x.id}: priority must be ${PRIORITIES.join('|')}`);
    if (!FEATURE_STATUSES.includes(x.status)) errors.push(`${x.id}: status must be ${FEATURE_STATUSES.join('|')}`);
    if (!RELEASES.includes(x.release)) errors.push(`${x.id}: release must be ${RELEASES.join('|')}`);
    for (const k of ['acceptance', 'openQuestions', 'assumptions']) if (!Array.isArray(x[k])) errors.push(`${x.id}: ${k} must be an array`);
    if (x.requests != null && (!Array.isArray(x.requests) || x.requests.some((r) => !/^R[1-9]\d*$/.test(r)))) errors.push(`${x.id}: requests must be an array of request ids (R1, R2, …)`);
  }
  if (f.notFeatures != null && (!Array.isArray(f.notFeatures) || f.notFeatures.some((n) => !Array.isArray(n?.requests) || !n.reason?.trim()))) errors.push('notFeatures must be an array of { "requests": ["R#"], "reason": "…" }');
  return errors;
}

/** Is the scope ready to turn into requirements and tasks? Errors block; warnings are shown in the review. */
export function readiness(f) {
  const errors = [], warnings = [];
  const mvp = f.features.filter((x) => x.status === 'accepted' && x.release === 'MVP');
  if (!mvp.length) errors.push('no accepted MVP features yet');
  for (const x of f.features) if (x.status === 'proposed') errors.push(`${x.id} (${x.title}): still proposed; accept, defer or reject it`);
  for (const x of mvp) {
    if (!x.acceptance.length) errors.push(`${x.id} (${x.title}): needs acceptance criteria`);
    if (!x.story) warnings.push(`${x.id} (${x.title}): no user story`);
    for (const q of x.openQuestions) errors.push(`${x.id} (${x.title}): open question: ${q}`);
  }
  for (const x of f.features) for (const a of x.assumptions) warnings.push(`${x.id} assumption: ${a}`);
  return { errors, warnings, mvp: mvp.length };
}

/** Accepted MVP features must be covered by tasks; tasks may only reference known features. */
export function coverage(features, tasks) {
  const errors = [];
  const known = new Set(features.features.map((x) => x.id));
  const byFeature = new Map(features.features.map((x) => [x.id, []]));
  for (const t of tasks.tasks) for (const id of t.features || []) {
    if (!known.has(id)) errors.push(`${t.id}: unknown feature ${id}`);
    else byFeature.get(id).push(t);
  }
  for (const x of features.features) if (x.status === 'accepted' && x.release === 'MVP' && !byFeature.get(x.id).length) errors.push(`${x.id} (${x.title}): accepted MVP feature has no tasks`);
  return { errors, byFeature };
}

export function sortedFeatures(f) {
  return [...f.features].sort((a, b) => RELEASES.indexOf(a.release) - RELEASES.indexOf(b.release) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.id.localeCompare(b.id, undefined, { numeric: true }));
}

/** Merge features by id: new ids are appended, existing ids are updated field by field. */
export function upsertFeatures(cwd, incoming, { notFeatures } = {}) {
  const f = loadFeatures(cwd);
  let added = 0, updated = 0;
  // notFeatures entries are keyed by their request ids; a later entry for the same ids replaces the earlier one.
  if (notFeatures?.length) { const key = (n) => [...(n.requests || [])].sort().join(','); f.notFeatures = [...(f.notFeatures || []).filter((n) => !notFeatures.some((m) => key(m) === key(n))), ...notFeatures]; }
  for (const x of incoming) {
    if (!x.id) x.id = `F${Math.max(0, ...f.features.map((y) => Number(y.id.slice(1)) || 0)) + 1}`;
    const cur = f.features.find((y) => y.id === x.id);
    if (cur) { Object.assign(cur, x); updated++; } else { f.features.push(x); added++; }
  }
  normaliseFeatures(f);
  const errors = validateFeatures(f);
  if (errors.length) throw new Error(errors.join('\n'));
  saveFeatures(cwd, f);
  appendLog(cwd, { type: 'note', message: `features: ${added} added, ${updated} updated` });
  return { added, updated, total: f.features.length };
}

export function setFeature(cwd, id, field, value) {
  const f = loadFeatures(cwd);
  const x = f.features.find((y) => y.id === id);
  if (!x) throw new Error(`unknown feature ${id}`);
  if (!['status', 'priority', 'release', 'title', 'story'].includes(field)) throw new Error('field must be status, priority, release, title or story');
  const from = x[field];
  x[field] = value;
  const errors = validateFeatures(f);
  if (errors.length) throw new Error(errors.join('\n'));
  saveFeatures(cwd, f);
  appendLog(cwd, { type: 'note', message: `${id} ${field}: ${from ?? '—'} → ${value}` });
  return x;
}

/** Every request statement (R#) must be delivered by a feature or explained in notFeatures
 * (a delivery instruction, or scope the user excluded). Deferred and rejected features count:
 * they are recorded decisions the user saw. */
export function requestCoverage(f, items) {
  const known = new Set(items.map((r) => r.id));
  const mapped = new Map();
  const note = (id, by) => { if (!mapped.has(id)) mapped.set(id, []); mapped.get(id).push(by); };
  const errors = [];
  for (const x of f.features) for (const id of x.requests || []) { if (!known.has(id)) errors.push(`${x.id}: unknown request ${id}`); else note(id, x.id); }
  for (const n of f.notFeatures || []) for (const id of n.requests || []) { if (!known.has(id)) errors.push(`notFeatures: unknown request ${id}`); else note(id, 'notFeatures'); }
  const uncovered = items.filter((r) => !mapped.has(r.id));
  for (const r of uncovered) errors.push(`${r.id} is not mapped to a feature or notFeatures: "${r.text.length > 120 ? r.text.slice(0, 117) + '…' : r.text}"`);
  return { errors, uncovered, mapped };
}
