import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { stateDir } from './state.js';
import { nowIso, readJson, writeJson } from './util/fs.js';

export const hash = (value) => createHash('sha256').update(value).digest('hex');
export function projectPath(cwd, relative) {
  if (typeof relative !== 'string' || !relative.trim() || path.isAbsolute(relative) || /^[A-Za-z]:/.test(relative) || relative.includes('\\') || /[*?\[\]{}]/.test(relative) || relative.split('/').includes('..') || path.posix.normalize(relative).replace(/\/$/, '') === '.' || relative.startsWith('/')) throw new Error(`expected a concrete repository-relative path: ${relative}`);
  const full = path.resolve(cwd, relative);
  const root = fs.realpathSync(cwd);
  let existing = full;
  while (!fs.existsSync(existing) && path.dirname(existing) !== existing) existing = path.dirname(existing);
  const real = fs.realpathSync(existing);
  if (real !== root && !real.startsWith(root + path.sep)) throw new Error(`path escapes repository: ${relative}`);
  return full;
}
export function fileDigest(cwd, relative) {
  const full = projectPath(cwd, relative);
  if (!fs.existsSync(full)) return null;
  const stat = fs.lstatSync(full);
  if (stat.isSymbolicLink() && fs.statSync(full).isDirectory()) throw new Error(`declare the real directory path instead of a symlink: ${relative}`);
  if (stat.isSymbolicLink()) return hash(`symlink:${fs.readlinkSync(full)}:${fileDigest(cwd, path.relative(cwd, fs.realpathSync(full)).split(path.sep).join('/'))}`);
  if (stat.isDirectory()) {
    const children = fs.readdirSync(full).sort();
    return hash(JSON.stringify(children.map((name) => [name, fileDigest(cwd, `${relative.replace(/\/$/, '')}/${name}`)])));
  }
  if (!stat.isFile()) throw new Error(`not a regular source file: ${relative}`);
  return hash(fs.readFileSync(full));
}
const DOCS = ['request.md', 'concept.md', 'plan.md', 'prd.md', 'ux.md', 'architecture.md', 'decisions.md', 'features.json', 'baseline.md', 'lessons.md'];
export function taskSignature(task) {
  // gates joins the signature only when set, so evidence recorded before quality profiles stays valid.
  return hash(JSON.stringify(Object.fromEntries([...['title', 'description', 'acceptance', 'features', 'dependsOn', 'risk', 'sources', 'writes'].map((k) => [k, task[k] ?? null]), ...(task.gates?.length ? [['gates', task.gates]] : [])])));
}
export function taskSnapshot(cwd, task, { planning = true } = {}) {
  const files = [...new Set([...(planning ? DOCS.map((f) => `.product-planner/${f}`) : []), ...(task.sources || []), ...(task.writes || [])])];
  const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' });
  return { capturedAt: nowIso(), revision: revision.status === 0 ? revision.stdout.trim() : null, signature: taskSignature(task), files: Object.fromEntries(files.map((f) => [f, fileDigest(cwd, f)])) };
}
export function compareSnapshot(cwd, saved, task) {
  if (!saved?.files) return { status: 'unknown', changed: [], reason: 'No source snapshot; inspect current sources and capture evidence.' };
  const changed = Object.entries(saved.files).filter(([f, digest]) => fileDigest(cwd, f) !== digest).map(([f]) => f);
  if (task && saved.signature !== taskSignature(task)) changed.push('task specification');
  return { status: changed.length ? 'stale' : 'fresh', changed, capturedAt: saved.capturedAt, revision: saved.revision, declaredSources: task?.sources?.length || 0 };
}
const evidencePath = (cwd, id) => path.join(stateDir(cwd), 'evidence', `${id}.json`);
export function captureTask(cwd, task) { const saved = taskSnapshot(cwd, task); writeJson(evidencePath(cwd, task.id), saved); return saved; }
export function taskFreshness(cwd, task) { return compareSnapshot(cwd, readJson(evidencePath(cwd, task.id)), task); }
