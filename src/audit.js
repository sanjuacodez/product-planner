import path from 'node:path';
import { loadState, stateDir } from './state.js';
import { loadTasks, validateTasks } from './tasks.js';
import { loadFeatures, validateFeatures, readiness, coverage } from './features.js';
import { readJson, readText, writeJson, writeText, nowIso } from './util/fs.js';
import { hash, taskSnapshot, compareSnapshot } from './evidence.js';
import { validateRows, completionEvidence } from './verification.js';
import { requestItems } from './request.js';
import { loadProfile } from './profile.js';

export function auditTemplate(cwd) {
  const request = readText(path.join(stateDir(cwd), 'request.md'), '');
  const profile = loadProfile(cwd);
  const criteria = [
    ...requestItems(cwd).map((r) => `${r.id}: ${r.text}`),
    ...loadFeatures(cwd).features.filter((f) => f.status === 'accepted' && f.release === 'MVP').flatMap((f) => f.acceptance.map((a) => `${f.id}: ${a}`)),
    ...(profile?.gates || []).filter((g) => g.type !== 'legal').map((g) => `${g.id}: ${g.title}`),
  ];
  // Legal obligations are reported for review, never passed by the audit.
  const legalReview = (profile?.gates || []).filter((g) => g.type === 'legal').map((g) => ({ gate: g.id, title: g.title, status: 'needs legal review' }));
  return { requestHash: hash(request), criteria: criteria.map((criterion) => ({ criterion, status: 'not_verified', evidence: '' })), integration: '', ...(legalReview.length ? { legalReview } : {}) };
}
const auditPath = (cwd) => path.join(stateDir(cwd), 'acceptance.json');
function auditSnapshot(cwd) {
  const tasks = loadTasks(cwd).tasks;
  return { ...taskSnapshot(cwd, { title: 'Final acceptance audit', sources: [...new Set(tasks.flatMap((t) => [...(t.sources || []), ...(t.writes || [])]))] }), graph: hash(JSON.stringify(tasks.map((t) => ({ id: t.id, status: t.status, acceptance: t.acceptance, dependsOn: t.dependsOn, features: t.features })))), product: hash(JSON.stringify(loadState(cwd).product)) };
}
export function recordAudit(cwd, report) {
  const template = auditTemplate(cwd), tasks = loadTasks(cwd), features = loadFeatures(cwd);
  const errors = [...validateTasks(tasks), ...validateFeatures(features), ...readiness(features).errors, ...coverage(features, tasks).errors, ...validateRows(template.criteria.map((r) => r.criterion), report.criteria)];
  if (!readText(path.join(stateDir(cwd), 'request.md'), '').trim()) errors.push('Original request is missing');
  if (!tasks.tasks.length || tasks.tasks.some((t) => t.status !== 'done')) errors.push('All tasks must be done before final acceptance');
  if (report.requestHash !== template.requestHash) errors.push('Original request changed; regenerate and review the audit');
  if (!report.integration?.trim()) errors.push('Final integration/test-suite evidence required');
  if (tasks.epics.length > 1) for (const e of tasks.epics) if (tasks.tasks.some((t) => t.epic === e.id) && !e.review) errors.push(`${e.id}: no increment review; run epic review ${e.id} --evidence "…"`);
  for (const task of tasks.tasks) { const e = completionEvidence(cwd, task); if (e.status !== 'pass') errors.push(`${task.id}: ${e.errors.join('; ')}`); }
  if (errors.length) throw new Error(errors.join('; '));
  const saved = { ...report, recordedAt: nowIso(), snapshot: auditSnapshot(cwd), status: 'pass' };
  writeJson(auditPath(cwd), saved);
  writeText(path.join(stateDir(cwd), 'acceptance.md'), `# Acceptance audit\n\nRecorded ${saved.recordedAt}\n\n${report.criteria.map((r) => `- **pass** ${r.criterion}\n  Evidence: ${r.evidence}`).join('\n\n')}\n\nIntegration: ${report.integration}\n${template.legalReview?.length ? `\n## Needs legal review (not passed by tests)\n\n${template.legalReview.map((l) => `- ${l.gate}: ${l.title}`).join('\n')}\n` : ''}`);
  return saved;
}
export function auditStatus(cwd) {
  const saved = readJson(auditPath(cwd));
  if (!saved) return { status: 'unknown', changed: [] };
  const freshness = compareSnapshot(cwd, saved.snapshot);
  const current = auditSnapshot(cwd);
  if (saved.snapshot.graph !== current.graph) freshness.changed.push('task graph');
  if (saved.snapshot.product !== current.product) freshness.changed.push('product concept');
  return { status: freshness.changed.length ? 'stale' : 'pass', changed: freshness.changed, recordedAt: saved.recordedAt };
}
