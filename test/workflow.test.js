import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { init } from '../src/init/index.js';
import { loadState, saveState } from '../src/state.js';
import { loadTasks } from '../src/tasks.js';
import { requestItems } from '../src/request.js';
import { planningProfile } from '../src/planning.js';
import { costOf, modelLabel } from '../src/pricing.js';
import { buildDashboard } from '../src/dashboard/index.js';

const CLI = path.resolve('bin/product-planner.js');
async function project(t, tools = 'generic') {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-workflow-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  await init(cwd, { tools });
  const st = loadState(cwd); st.options.autoOpenDashboard = false; saveState(cwd, st);
  return cwd;
}
const write = (cwd, file, value) => { const full = path.join(cwd, file); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, typeof value === 'string' ? value : JSON.stringify(value)); };
const run = (cwd, ...a) => spawnSync(process.execPath, [CLI, ...a], { cwd, encoding: 'utf8' });
const ok = (cwd, ...a) => { const r = run(cwd, ...a); assert.equal(r.status, 0, `${a.join(' ')}\n${r.stderr}${r.stdout}`); return r.stdout; };

const REQUEST = `# Request

Build a tip calculator module.

- tip(amount, percent) returns the tip rounded to 2 decimals.
- Negative amounts throw INVALID_AMOUNT.

Build it, test it and document it.`;

const PLAN = {
  features: [
    { id: 'F1', title: 'Tip', status: 'accepted', priority: 'must', release: 'MVP', requests: ['R1', 'R2'], acceptance: ['tip(100, 15) returns 15'] },
    { id: 'F2', title: 'Validation', status: 'accepted', priority: 'must', release: 'MVP', requests: ['R3'], acceptance: ['tip(-1, 10) throws INVALID_AMOUNT'] },
  ],
  notFeatures: [{ requests: ['R4'], reason: 'delivery instruction: covered by tests and README in every task' }],
  epics: [{ id: 'E1', title: 'Core' }, { id: 'E2', title: 'Validation' }],
  tasks: [
    { id: 'T1', epic: 'E1', title: 'Tip', features: ['F1'], risk: 'low', writes: ['tip.js'], acceptance: ['tip(100, 15) returns 15'] },
    { id: 'T2', epic: 'E2', title: 'Validation', features: ['F2'], risk: 'low', writes: ['tip.js'], dependsOn: ['T1'], acceptance: ['tip(-1, 10) throws INVALID_AMOUNT'] },
  ],
};
const fill = (report) => { report.criteria.forEach((r) => { r.status = 'pass'; r.evidence = 'node --test tip.test.js passed'; }); if (report.checks) for (const k of Object.keys(report.checks)) report.checks[k] = 'node --test: 4 passed, 0 failed'; return report; };

test('request statements get stable ids per paragraph and list item', async (t) => {
  const cwd = await project(t); write(cwd, '.product-planner/request.md', REQUEST);
  assert.deepEqual(requestItems(cwd).map((r) => r.id + ' ' + r.text.slice(0, 12)), ['R1 Build a tip ', 'R2 tip(amount, ', 'R3 Negative amo', 'R4 Build it, te']);
});

test('direct path: import with request coverage, approve and lock, complete tasks, review epics, audit, done', async (t) => {
  const cwd = await project(t);
  ok(cwd, 'state', 'set', 'options.track', 'direct');
  assert.equal(planningProfile(cwd).depth, 'direct'); assert.ok(!planningProfile(cwd).documents.includes('concept.md'));
  write(cwd, '.product-planner/request.md', REQUEST);
  // An unmapped request statement blocks the plan.
  const partial = structuredClone(PLAN); delete partial.notFeatures; write(cwd, 'partial.json', partial);
  const bad = run(cwd, 'plan', 'import', '--file', 'partial.json');
  assert.equal(bad.status, 1); assert.match(bad.stdout, /request coverage: R4 is not mapped/);
  assert.notEqual(run(cwd, 'plan', 'approve', '--reason', 'request authorized building').status, 0);
  write(cwd, 'plan.json', PLAN); assert.match(ok(cwd, 'plan', 'import', '--file', 'plan.json'), /plan check: ok/);
  assert.match(ok(cwd, 'plan', 'approve', '--reason', 'request authorized building'), /approved and locked/);
  const st = loadState(cwd); assert.equal(st.phase, 'build'); assert.equal(st.planning.handoff, 'done'); assert.ok(st.lock.request);
  // Build: one command per task completion.
  write(cwd, 'tip.js', 'export const tip = (a, p) => a * p / 100;');
  ok(cwd, 'task', 'start', 'T1', '--agent', 'developer', '--model', 'claude-sonnet-5-5');
  ok(cwd, 'task', 'verify', 'T1', '--template', '--out', 'r1.json');
  write(cwd, 'r1.json', fill(JSON.parse(fs.readFileSync(path.join(cwd, 'r1.json'), 'utf8'))));
  const out = ok(cwd, 'task', 'complete', 'T1', '--file', 'r1.json', '--agent', 'qa', '--model', 'claude-haiku-5-5');
  assert.match(out, /T1 → done/); assert.match(out, /epic E1 complete/);
  assert.deepEqual(loadTasks(cwd).tasks[0].workedBy.map((w) => w.agent), ['developer', 'qa']);
  ok(cwd, 'epic', 'review', 'E1', '--evidence', 'node --test: all suites pass');
  ok(cwd, 'task', 'start', 'T2'); ok(cwd, 'task', 'verify', 'T2', '--template', '--out', 'r2.json');
  write(cwd, 'r2.json', fill(JSON.parse(fs.readFileSync(path.join(cwd, 'r2.json'), 'utf8'))));
  write(cwd, 'tip.js', 'export const tip = (a, p) => { if (a < 0) throw Object.assign(new Error(), { code: "INVALID_AMOUNT" }); return a * p / 100; };');
  ok(cwd, 'task', 'complete', 'T2', '--file', 'r2.json');
  // Audit needs every epic reviewed when there is more than one.
  ok(cwd, 'audit', 'template', '--out', 'audit.json');
  const audit = fill(JSON.parse(fs.readFileSync(path.join(cwd, 'audit.json'), 'utf8'))); audit.integration = 'node --test: 4 passed';
  assert.deepEqual(audit.criteria.map((r) => r.criterion.split(':')[0]), ['R1', 'R2', 'R3', 'R4', 'F1', 'F2']);
  write(cwd, 'audit.json', audit);
  assert.match(run(cwd, 'audit', 'check', '--file', 'audit.json').stderr, /E2: no increment review/);
  ok(cwd, 'epic', 'review', 'E2', '--evidence', 'node --test: all suites pass');
  ok(cwd, 'audit', 'check', '--file', 'audit.json'); ok(cwd, 'state', 'phase', 'done');
  assert.equal(loadState(cwd).phase, 'done');
  // A later change to the request without a replan shows as drift.
  fs.appendFileSync(path.join(cwd, '.product-planner/request.md'), '\n\nAlso support a split between people.');
  const after = run(cwd, 'check'); assert.equal(after.status, 1);
  assert.match(after.stdout, /changed since the plan was approved: request/); assert.match(after.stdout, /R5 is not mapped/);
});

test('task complete refuses incomplete evidence and leaves the task in review', async (t) => {
  const cwd = await project(t); write(cwd, '.product-planner/request.md', REQUEST); write(cwd, 'plan.json', PLAN);
  ok(cwd, 'plan', 'import', '--file', 'plan.json'); ok(cwd, 'task', 'start', 'T1');
  write(cwd, 'r.json', { criteria: [{ criterion: 'tip(100, 15) returns 15', status: 'pass', evidence: 'x' }], checks: {} });
  const r = run(cwd, 'task', 'complete', 'T1', '--file', 'r.json');
  assert.equal(r.status, 1); assert.match(r.stderr, /check evidence required: test suite/);
  assert.equal(loadTasks(cwd).tasks[0].status, 'review');
});

test('the always-loaded instruction block stays small and routes small precise work to pp-direct', async (t) => {
  const cwd = await project(t, 'claude');
  const block = fs.readFileSync(path.join(cwd, 'CLAUDE.md'), 'utf8');
  assert.ok(block.length < 3500, `CLAUDE.md block is ${block.length} bytes`);
  assert.match(block, /`pp-direct`/); assert.match(block, /reference manual/);
  assert.ok(fs.existsSync(path.join(cwd, '.claude/commands/pp-direct.md')));
});

test('pricing: labels, dated snapshots, cache write tiers and unknown models', () => {
  assert.equal(modelLabel('claude-sonnet-5-5'), 'Sonnet 5.5'); assert.equal(modelLabel('claude-opus-5'), 'Opus 5');
  assert.equal(modelLabel('gpt-x', { 'gpt-x': 'GPT X' }), 'GPT X'); assert.equal(modelLabel('mystery-model'), 'mystery-model');
  // 1M input $4 + 1M output $20 + 1M cache read $0.20 + 1M 5-minute writes $5 + 1M 1-hour writes $8 on Opus 5.5
  assert.equal(costOf({ input: 1e6, output: 1e6, cacheRead: 1e6, cacheWrite: 2e6, cacheWrite1h: 1e6 }, 'claude-opus-5-5').toFixed(2), '37.20');
  assert.equal(costOf({ output: 1e6 }, 'claude-sonnet-5-5-20261001'), 10);
  assert.equal(costOf({ output: 1e6 }, 'mystery-model'), null);
  assert.equal(costOf({ output: 1e6 }, 'mystery-model', { 'mystery-model': { input: 1, output: 3, cacheRead: 0.1 } }), 3);
});

test('dashboard shows estimated cost by product, epic and role, and flags a reported model the transcripts do not show', async (t) => {
  const cwd = await project(t); write(cwd, '.product-planner/request.md', REQUEST); write(cwd, 'plan.json', PLAN);
  ok(cwd, 'plan', 'import', '--file', 'plan.json');
  ok(cwd, 'task', 'start', 'T1', '--agent', 'developer', '--model', 'claude-opus-5-5');
  const entry = (tasks, model, output) => JSON.stringify({ ts: 'x', model, tokens: { input: 0, cacheWrite: 0, cacheRead: 0, output }, ...(tasks ? { tasks, attribution: 'estimated' } : { phase: 'planning' }), stage: tasks ? 'build' : 'planning' });
  write(cwd, '.product-planner/usage.jsonl', [entry(null, 'claude-opus-5-5', 50000), entry(['T1'], 'claude-sonnet-5-5', 100000), entry(['T1'], 'unknown-model', 7)].join('\n') + '\n');
  const html = fs.readFileSync(buildDashboard(cwd), 'utf8');
  assert.match(html, /Estimated cost<\/div><div class="tile-v">\$2\.00/); // $1.00 planning (Opus) + $1.00 T1 (Sonnet)
  assert.match(html, /<b>Developer<\/b> · Opus 5\.5/);
  assert.match(html, /⚠ transcript model: Sonnet 5\.5/);
  assert.match(html, /7 tokens from unknown-model have no known price/);
  assert.match(html, /Est\. cost<\/th>/);
  assert.match(ok(cwd, 'usage'), /Estimated cost: \$2\.00/);
});

test('planned role models are written into Claude Code agent files; the tiered preset delegates tasks', async (t) => {
  const cwd = await project(t, 'claude');
  const agent = (role) => fs.readFileSync(path.join(cwd, `.claude/agents/pp-${role}.md`), 'utf8');
  assert.doesNotMatch(agent('developer'), /^model:/m);
  assert.match(ok(cwd, 'models', 'tiered'), /developer=sonnet, qa=haiku\); delegate tasks: yes; 10 Claude Code agent files updated/);
  assert.match(agent('developer'), /^model: sonnet$/m); assert.match(agent('qa'), /^model: haiku$/m); assert.doesNotMatch(agent('architect'), /^model:/m);
  assert.equal(loadState(cwd).options.delegateTasks, true);
  ok(cwd, 'state', 'set', 'models.architect', 'claude-opus-5-5');
  assert.match(agent('architect'), /^model: claude-opus-5-5$/m);
  ok(cwd, 'auto', 'off'); assert.match(agent('qa'), /^model: haiku$/m); // reinstalling keeps planned models
  ok(cwd, 'models', 'inherit'); assert.doesNotMatch(agent('developer'), /^model:/m);
  assert.match(ok(cwd, 'models', 'show'), /none \(every role inherits/);
});

test('delegated mode: task start tells the coordinator to hand the task to sub-agents, except high-risk tasks', async (t) => {
  const cwd = await project(t, 'claude'); write(cwd, '.product-planner/request.md', REQUEST); write(cwd, 'plan.json', PLAN);
  ok(cwd, 'plan', 'import', '--file', 'plan.json'); ok(cwd, 'models', 'tiered');
  assert.match(ok(cwd, 'task', 'start', 'T1'), /delegated mode: do not implement T1 here/);
  ok(cwd, 'models', 'inherit'); ok(cwd, 'task', 'reopen', 'T1');
  assert.doesNotMatch(ok(cwd, 'task', 'start', 'T1'), /delegated mode/);
});
