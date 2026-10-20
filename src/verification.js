import path from 'node:path';
import { stateDir } from './state.js';
import { readJson, writeJson, nowIso } from './util/fs.js';
import { taskSnapshot, compareSnapshot, taskSignature } from './evidence.js';

export function verificationPolicy(task) {
  const escalated = (task.qaReturns || 0) >= 3;
  const level = escalated || task.risk === 'high' ? 'high' : task.risk === 'low' ? 'low' : 'medium';
  // Quality gates the task delivers are checked with every verification of it (command output or checklist evidence).
  const gates = (task.gates || []).map((g) => `gate ${g}`);
  return { level, escalated, independentReview: level !== 'low', checks: [...(level === 'high' ? ['acceptance', 'test suite', 'integration', 'security and data integrity review'] : ['acceptance', 'test suite']), ...gates], finalAudit: true };
}
/** Report skeleton with the exact criterion strings and the checks this task's risk level requires. */
export function verificationTemplate(task) {
  const policy = verificationPolicy(task);
  return {
    criteria: task.acceptance.map((criterion) => ({ criterion, status: 'not_verified', evidence: '' })),
    ...(policy.independentReview ? { reviewer: '', reviewEvidence: '' } : {}),
    checks: Object.fromEntries(policy.checks.filter((c) => c !== 'acceptance').map((c) => [c, ''])),
  };
}
export function validateRows(expected, actual) {
  const errors = [];
  if (!Array.isArray(actual)) return ['criteria must be an array'];
  const keys = actual.map((r) => r?.criterion);
  if (new Set(keys).size !== keys.length) errors.push('duplicate acceptance criterion');
  for (const criterion of expected) {
    const row = actual.find((r) => r?.criterion === criterion);
    if (!row || row.status !== 'pass' || typeof row.evidence !== 'string' || !row.evidence.trim()) errors.push(`missing passing evidence: ${criterion}`);
  }
  for (const key of keys) if (!expected.includes(key)) errors.push(`unknown acceptance criterion: ${key}`);
  return errors;
}
const verifyPath = (cwd, id) => path.join(stateDir(cwd), 'verification', `${id}.json`);
export function recordVerification(cwd, task, report) {
  const errors = validateRows(task.acceptance, report.criteria);
  const policy = verificationPolicy(task);
  if (policy.independentReview && (!report.reviewer?.trim() || !report.reviewEvidence?.trim())) errors.push('independent reviewer and reviewEvidence required for medium/high risk');
  for (const check of policy.checks.filter((c) => c !== 'acceptance')) if (!report.checks?.[check]?.trim()) errors.push(`check evidence required: ${check}`);
  if (errors.length) throw new Error(errors.join('; '));
  const result = { ...report, policy, recordedAt: nowIso(), snapshot: taskSnapshot(cwd, task, { planning: false }) };
  writeJson(verifyPath(cwd, task.id), result);
  return result;
}
/** Verification recorded when the task was completed: it must match the task's current
 * specification, but later edits by other tasks do not invalidate it. The final audit and
 * full test suite check the current code. */
export function completionEvidence(cwd, task) {
  const saved = readJson(verifyPath(cwd, task.id));
  if (!saved) return { status: 'unknown', errors: ['No acceptance evidence recorded.'] };
  const errors = validateRows(task.acceptance, saved.criteria);
  if (saved.snapshot?.signature !== taskSignature(task)) errors.push('task specification changed after verification; verify again');
  return { status: errors.length ? 'stale' : 'pass', errors };
}
export function verificationStatus(cwd, task) {
  const saved = readJson(verifyPath(cwd, task.id));
  if (!saved) return { status: 'unknown', errors: ['No acceptance evidence; run task verify with a report file.'] };
  const errors = validateRows(task.acceptance, saved.criteria);
  const freshness = compareSnapshot(cwd, saved.snapshot, task);
  if (freshness.status !== 'fresh') errors.push(`verification evidence is stale: ${freshness.changed.join(', ')}`);
  if (verificationPolicy(task).level !== saved.policy?.level) errors.push('risk policy changed; verify again');
  return { status: errors.length ? 'stale' : 'pass', errors, report: saved };
}
