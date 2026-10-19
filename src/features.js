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
  }
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
export function upsertFeatures(cwd, incoming) {
  const f = loadFeatures(cwd);
  let added = 0, updated = 0;
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
