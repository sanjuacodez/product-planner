import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { init } from '../src/init/index.js';
import { addTask, updateTask, loadTasks, transition } from '../src/tasks.js';
import { loadState, saveState } from '../src/state.js';
import { planningProfile, planningText } from '../src/planning.js';
import { executionBatch } from '../src/execution.js';
import { captureTask, taskFreshness, projectPath } from '../src/evidence.js';
import { buildIndex, searchMemory } from '../src/memory/index.js';
import { verificationPolicy, recordVerification } from '../src/verification.js';
import { auditTemplate, recordAudit, auditStatus } from '../src/audit.js';
import { upsertFeatures } from '../src/features.js';
import { snapshot, summarizeUsage, transcriptTotals, readUsage, bindUsage } from '../src/usage.js';

async function fixture(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-improvements-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  await init(cwd, { tools: 'generic' }); return cwd;
}
const write = (cwd, file, value) => { const full = path.join(cwd, file); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, value); };
const report = (task) => ({ criteria: task.acceptance.map((criterion) => ({ criterion, status: 'pass', evidence: 'node --test: acceptance case passed' })), reviewer: 'qa', reviewEvidence: 'Reviewed diff and acceptance tests', checks: { 'test suite': 'node --test: existing cases pass', integration: 'node --test: integration passes', 'security and data integrity review': 'Verified atomic update and input validation' } });
function task(cwd, id, fields = {}) { return addTask(cwd, { id, title: `Task ${id}`, acceptance: ['Returns the documented output'], ...fields }); }

test('quick plans have one canonical design document and preserve shared planning invariants', async (t) => {
  const cwd = await fixture(t), state = loadState(cwd); state.options.track = 'quick'; saveState(cwd, state);
  write(cwd, '.product-planner/plan.md', '# Plan\n## Requirements\n### FR-1 (F1)\nReturn JSON.\n## UX\nCLI output.\n## Architecture\n### Global constraints\nOffline only.\n## Roadmap\nMVP first.');
  write(cwd, '.product-planner/prd.md', 'OBSOLETE');
  const profile = planningProfile(cwd);
  assert.ok(profile.documents.includes('request.md')); assert.ok(profile.documents.includes('concept.md'));
  assert.ok(profile.documents.includes('plan.md')); assert.ok(!profile.documents.includes('prd.md'));
  assert.match(planningText(cwd, 'prd.md'), /Return JSON/); assert.doesNotMatch(planningText(cwd, 'prd.md'), /Offline only|OBSOLETE/);
  assert.match(planningText(cwd, 'architecture.md'), /Offline only/);
  state.options.track = 'existing'; state.options.planningDepth = 'quick'; saveState(cwd, state);
  assert.equal(planningProfile(cwd).existing, true);
});

test('batch scheduling excludes dependencies, overlapping directories, read/write conflicts and undeclared ownership', async (t) => {
  const cwd = await fixture(t);
  task(cwd, 'T1', { writes: ['src/ui/'], sources: ['contracts/api.json'] });
  task(cwd, 'T2', { writes: ['src/ui/button.js'] });
  task(cwd, 'T3', { writes: ['contracts/api.json'] });
  task(cwd, 'T4', { writes: ['src/export.js'] });
  task(cwd, 'T5', { writes: ['src/later.js'], dependsOn: ['T1'] });
  task(cwd, 'T6');
  let batch = executionBatch(cwd);
  assert.deepEqual(batch.tasks.map((t) => t.id), ['T1', 'T4']);
  assert.ok(batch.skipped.find((t) => t.id === 'T2').reason.includes('conflicts'));
  assert.ok(batch.skipped.find((t) => t.id === 'T3').reason.includes('conflicts'));
  assert.ok(batch.skipped.find((t) => t.id === 'T6').reason.includes('Missing'));
  transition(cwd, 'T1', 'in_progress');
  batch = executionBatch(cwd); assert.deepEqual(batch.tasks.map((t) => t.id), ['T4']);
  assert.equal(loadTasks(cwd).tasks.find((t) => t.id === 'T4').status, 'todo');
});

test('batch compares symlink aliases and respects active tasks with unknown ownership', async (t) => {
  const cwd = await fixture(t); write(cwd, 'src/a.js', 'x'); fs.symlinkSync(path.join(cwd, 'src'), path.join(cwd, 'alias'));
  task(cwd, 'T1', { writes: ['src/a.js'] }); task(cwd, 'T2', { writes: ['alias/a.js'] });
  assert.deepEqual(executionBatch(cwd).tasks.map((t) => t.id), ['T1']);
  task(cwd, 'T3'); transition(cwd, 'T3', 'in_progress'); assert.deepEqual(executionBatch(cwd).tasks, []);
  const state = loadState(cwd); state.options.maxConcurrentTasks = 0; saveState(cwd, state);
  assert.throws(() => executionBatch(cwd), /positive integer/);
});

test('evidence detects content, deleted files, task changes and planning changes without relying on mtime', async (t) => {
  const cwd = await fixture(t); write(cwd, 'src/core.js', 'old');
  const a = task(cwd, 'T1', { sources: ['src/core.js'] });
  assert.equal(taskFreshness(cwd, a).status, 'unknown'); captureTask(cwd, a);
  assert.equal(taskFreshness(cwd, a).status, 'fresh');
  write(cwd, 'src/core.js', 'new'); assert.ok(taskFreshness(cwd, a).changed.includes('src/core.js'));
  captureTask(cwd, a); write(cwd, '.product-planner/concept.md', 'New goal');
  assert.ok(taskFreshness(cwd, a).changed.includes('.product-planner/concept.md'));
  captureTask(cwd, a); a.acceptance.push('Rejects invalid data'); assert.ok(taskFreshness(cwd, a).changed.includes('task specification'));
  captureTask(cwd, a); fs.unlinkSync(path.join(cwd, 'src/core.js')); assert.equal(taskFreshness(cwd, a).status, 'stale');
  for (const file of ['../outside', '/etc/passwd', '.', './', 'src/*.js']) assert.throws(() => projectPath(cwd, file));
});

test('memory excludes changed and deleted indexed evidence until re-indexed', async (t) => {
  const cwd = await fixture(t); write(cwd, '.product-planner/lessons.md', '# Authentication\nUse cookies.');
  await buildIndex(cwd);
  assert.equal((await searchMemory(cwd, 'cookies')).results.length, 1);
  write(cwd, '.product-planner/lessons.md', '# Authentication\nUse bearer tokens.');
  let found = await searchMemory(cwd, 'cookies'); assert.equal(found.results.length, 0); assert.equal(found.staleFiles.length, 1);
  await buildIndex(cwd); assert.equal((await searchMemory(cwd, 'bearer')).results.length, 1);
  fs.unlinkSync(path.join(cwd, '.product-planner/lessons.md')); found = await searchMemory(cwd, 'bearer'); assert.equal(found.results.length, 0);
});

test('task completion requires complete evidence and rejects source changes after verification', async (t) => {
  const cwd = await fixture(t); write(cwd, 'core.js', 'export const n = 1;');
  const a = task(cwd, 'T1', { writes: ['core.js'], risk: 'high' });
  transition(cwd, 'T1', 'in_progress'); transition(cwd, 'T1', 'review');
  assert.throws(() => transition(cwd, 'T1', 'done'), /No acceptance evidence/);
  const r = report(a); r.criteria[0].status = 'not_verified'; assert.throws(() => recordVerification(cwd, a, r), /missing passing/);
  const incomplete = report(a); delete incomplete.checks.integration; assert.throws(() => recordVerification(cwd, a, incomplete), /integration/);
  recordVerification(cwd, a, report(a)); write(cwd, 'core.js', 'export const n = 2;');
  assert.throws(() => transition(cwd, 'T1', 'done'), /stale/);
  recordVerification(cwd, a, report(a)); transition(cwd, 'T1', 'done');
  assert.equal(verificationPolicy({ risk: 'low' }).independentReview, false);
  assert.equal(verificationPolicy({ risk: 'low', qaReturns: 3 }).level, 'high');
});

test('final audit covers the original request, features and tasks, and becomes stale on changes', async (t) => {
  const cwd = await fixture(t); write(cwd, '.product-planner/request.md', '# Request\n\nReturn JSON.\n\nReject invalid inputs.');
  upsertFeatures(cwd, [{ id: 'F1', title: 'Output', status: 'accepted', priority: 'must', release: 'MVP', acceptance: ['Return JSON.'] }]);
  const a = task(cwd, 'T1', { features: ['F1'], writes: ['core.js'] }); write(cwd, 'core.js', 'ok');
  transition(cwd, 'T1', 'in_progress'); transition(cwd, 'T1', 'review'); recordVerification(cwd, a, report(a)); transition(cwd, 'T1', 'done');
  const audit = auditTemplate(cwd); assert.equal(audit.criteria.length, 3); assert.match(audit.criteria[0].criterion, /^R1: Return JSON\.$/);
  assert.throws(() => recordAudit(cwd, audit), /missing passing evidence/);
  audit.criteria.forEach((r) => { r.status = 'pass'; r.evidence = 'node --test acceptance and request audit passed'; }); audit.integration = 'npm test: all pass';
  recordAudit(cwd, audit); assert.equal(auditStatus(cwd).status, 'pass');
  const cli = path.resolve('bin/product-planner.js');
  assert.equal(spawnSync(process.execPath, [cli, 'state', 'phase', 'done'], { cwd }).status, 0);
  write(cwd, 'core.js', 'changed'); assert.equal(auditStatus(cwd).status, 'stale');
  assert.equal(spawnSync(process.execPath, [cli, 'state', 'phase', 'done'], { cwd }).status, 1);
});

const message = (id, model, output) => JSON.stringify({ type: 'assistant', message: { id, model, usage: { input_tokens: 1, output_tokens: output } } });
test('usage retains mixed models, bound workers, session-local attribution and integer totals', async (t) => {
  const cwd = await fixture(t); task(cwd, 'T1'); task(cwd, 'T2');
  const transcript = path.join(cwd, 's.jsonl'), worker = path.join(cwd, 's/subagents/a.jsonl');
  write(cwd, 's.jsonl', message('m1', 'large', 2) + '\n' + message('m1', 'large', 3));
  write(cwd, 's/subagents/a.jsonl', message('w1', 'small', 5)); bindUsage(cwd, worker, 'T2');
  const totals = transcriptTotals(transcript); assert.equal(totals.tokens.output, 8); assert.equal(totals.model, 'mixed');
  snapshot(cwd, { sessionId: 'a', transcriptPath: transcript });
  const sum = summarizeUsage(readUsage(cwd)); assert.equal(sum.byModel.large.output, 3); assert.equal(sum.byModel.small.output, 5); assert.equal(sum.byTask.T2.output, 5);
  snapshot(cwd, { sessionId: 'a', transcriptPath: transcript }); assert.equal(readUsage(cwd).length, 2);
  transition(cwd, 'T1', 'in_progress'); snapshot(cwd, { sessionId: 'a', transcriptPath: transcript });
  write(cwd, 'b.jsonl', message('b1', 'large', 7)); snapshot(cwd, { sessionId: 'b', transcriptPath: path.join(cwd, 'b.jsonl') });
  const b = readUsage(cwd).find((r) => r.session === 'b'); assert.equal(b.tasks, undefined);
  const allocation = summarizeUsage([{ tokens: { input: 1, output: 5 }, tasks: ['T1', 'T2', 'T3'], attribution: 'estimated' }]);
  assert.equal(Object.values(allocation.byTask).reduce((n, v) => n + v.output, 0), 5);
  assert.equal(Object.values(allocation.byTask).reduce((n, v) => n + v.input, 0), 1);
});

test('documented CLI flow: verify template, verification, done, audit and phase done', async (t) => {
  const cwd = await fixture(t), cli = path.resolve('bin/product-planner.js');
  const pp = (...a) => { const r = spawnSync(process.execPath, [cli, ...a], { cwd, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr + r.stdout); return r.stdout; };
  write(cwd, '.product-planner/request.md', '# Request\n\nPrint the total.');
  write(cwd, 'total.js', 'export const total = 1;');
  upsertFeatures(cwd, [{ id: 'F1', title: 'Total', status: 'accepted', priority: 'must', release: 'MVP', acceptance: ['Print the total.'] }]);
  task(cwd, 'T1', { writes: ['total.js'], risk: 'low', features: ['F1'] });
  pp('task', 'start', 'T1'); pp('task', 'capture', 'T1'); pp('task', 'review', 'T1');
  const low = JSON.parse(pp('task', 'verify', 'T1', '--template'));
  assert.deepEqual(Object.keys(low.checks), ['test suite']); assert.equal(low.reviewer, undefined);
  assert.deepEqual(Object.keys(JSON.parse(pp('task', 'verify', 'T1', '--template'))), ['criteria', 'checks']);
  low.criteria.forEach((r) => { r.status = 'pass'; r.evidence = 'node --test total.test.js passed'; }); low.checks['test suite'] = 'node --test: all pass';
  write(cwd, 'report.json', JSON.stringify(low)); pp('task', 'verify', 'T1', '--file', 'report.json');
  pp('task', 'done', 'T1');
  const audit = JSON.parse(pp('audit', 'template'));
  audit.criteria.forEach((r) => { r.status = 'pass'; r.evidence = 'node --test total.test.js passed'; }); audit.integration = 'node --test: all pass';
  write(cwd, 'audit.json', JSON.stringify(audit)); pp('audit', 'check', '--file', 'audit.json');
  pp('state', 'phase', 'done');
  assert.equal(loadState(cwd).phase, 'done');
  task(cwd, 'T2', { risk: 'high', acceptance: ['Rejects unauthorised access'] });
  const risky = JSON.parse(pp('task', 'verify', 'T2', '--template'));
  assert.equal(risky.criteria[0].criterion, 'Rejects unauthorised access'); assert.equal(risky.reviewer, '');
  assert.deepEqual(Object.keys(risky.checks), ['test suite', 'integration', 'security and data integrity review']);
});

test('the shipped task-plan template validates with ownership and risk fields', async (t) => {
  const cwd = await fixture(t);
  const r = spawnSync(process.execPath, [path.resolve('bin/product-planner.js'), 'task', 'add', '--file', path.resolve('kit/templates/task-plan.json')], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const t1 = loadTasks(cwd).tasks.find((x) => x.id === 'T1');
  assert.deepEqual(t1.writes, ['package.json', 'src/']); assert.equal(t1.risk, 'medium');
});

test('audit accepts verification recorded at completion after later tasks edit the same file, but not after a spec change', async (t) => {
  const cwd = await fixture(t); write(cwd, '.product-planner/request.md', '# Request\n\n- Return JSON.\n- Reject invalid inputs.');
  upsertFeatures(cwd, [{ id: 'F1', title: 'Output', status: 'accepted', priority: 'must', release: 'MVP', acceptance: ['Return JSON.'] }]);
  write(cwd, 'core.js', 'v1');
  const done = (id) => { const x = loadTasks(cwd).tasks.find((y) => y.id === id); transition(cwd, id, 'in_progress'); transition(cwd, id, 'review'); recordVerification(cwd, x, report(x)); transition(cwd, id, 'done'); };
  task(cwd, 'T1', { features: ['F1'], writes: ['core.js'] }); done('T1');
  write(cwd, 'core.js', 'v2 from a replan task');
  task(cwd, 'T2', { features: ['F1'], writes: ['core.js'] }); done('T2');
  const audit = auditTemplate(cwd);
  assert.deepEqual(audit.criteria.map((r) => r.criterion.split(':')[0]), ['R1', 'R2', 'F1']);
  audit.criteria.forEach((r) => { r.status = 'pass'; r.evidence = 'node --test passed'; }); audit.integration = 'npm test: all pass';
  recordAudit(cwd, audit);
  const graph = JSON.parse(fs.readFileSync(path.join(cwd, '.product-planner/tasks.json'), 'utf8')); graph.tasks[0].acceptance = ['Returns JSON with a version field'];
  fs.writeFileSync(path.join(cwd, '.product-planner/tasks.json'), JSON.stringify(graph)); // a hand edit of completed work
  assert.throws(() => recordAudit(cwd, auditTemplate(cwd)), /T1: .*task specification changed/);
});

test('template commands write files with --out, creating directories', async (t) => {
  const cwd = await fixture(t), cli = path.resolve('bin/product-planner.js');
  write(cwd, '.product-planner/request.md', 'Print the total.'); task(cwd, 'T1');
  for (const a of [['task', 'verify', 'T1', '--template', '--out', '.product-planner/verification/T1.report.json'], ['audit', 'template', '--out', '.product-planner/audit-report.json']]) {
    const r = spawnSync(process.execPath, [cli, ...a], { cwd, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr);
    assert.ok(JSON.parse(fs.readFileSync(path.join(cwd, a.at(-1)), 'utf8')).criteria.length);
  }
});
