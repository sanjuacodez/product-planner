import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { init } from '../src/init/index.js';
import { loadState, saveState } from '../src/state.js';
import { addTask, loadTasks, transition } from '../src/tasks.js';
import { taskNeeds, modelPool, recommend, setPool, blendedPrice, loadModelCatalog } from '../src/router.js';

const CLI = path.resolve('bin/product-planner.js');
async function project(t, tools = 'claude') {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-router-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  await init(cwd, { tools });
  const st = loadState(cwd); st.options.autoOpenDashboard = false; st.options.requireVerification = false; saveState(cwd, st);
  return cwd;
}
const ok = (cwd, ...a) => { const r = spawnSync(process.execPath, [CLI, ...a], { cwd, encoding: 'utf8' }); assert.equal(r.status, 0, `${a.join(' ')}\n${r.stderr}${r.stdout}`); return r.stdout; };
const task = (cwd, id, fields = {}) => addTask(cwd, { id, title: `Task ${id}`, acceptance: ['Works as stated'], ...fields });

test('task needs: role sets the starting tier; risk, QA returns and privacy gates escalate; small low-risk work may use the fast tier', () => {
  assert.equal(taskNeeds({ agent: 'developer', risk: 'medium' }).tier, 'strong');
  assert.equal(taskNeeds({ agent: 'architect' }).tier, 'frontier');
  assert.equal(taskNeeds({ agent: 'qa' }).tier, 'fast');
  assert.equal(taskNeeds({ agent: 'developer', risk: 'high' }).tier, 'frontier');
  assert.equal(taskNeeds({ agent: 'developer', qaReturns: 1 }).tier, 'frontier');
  assert.equal(taskNeeds({ agent: 'developer', gates: ['G-PRIV-RIGHTS'] }).tier, 'frontier');
  assert.equal(taskNeeds({ agent: 'developer', risk: 'low', estimate: 'S' }).tier, 'fast');
  assert.equal(taskNeeds({ agent: 'developer', risk: 'low', estimate: 'S', gates: ['G-WP-PHPCS'] }).tier, 'strong');
  assert.equal(taskNeeds({ agent: 'developer', risk: 'medium' }).review, 'strong'); assert.equal(taskNeeds({ agent: 'developer', risk: 'low' }).review, null);
});

test('one provider: the cheapest model that meets each task, review in a fresh context, Claude agent files get aliases', async (t) => {
  const cwd = await project(t);
  assert.deepEqual(modelPool(cwd).models.map((m) => m.id).sort(), ['claude-fable-5-1', 'claude-haiku-5-5', 'claude-opus-5-5', 'claude-sonnet-5-5']);
  task(cwd, 'T1', { agent: 'developer', risk: 'medium' });
  task(cwd, 'T2', { agent: 'architect' });
  task(cwd, 'T3', { agent: 'qa', risk: 'low' });
  task(cwd, 'T4', { agent: 'developer', risk: 'high' });
  const rec = recommend(cwd);
  const pick = Object.fromEntries(rec.tasks.map((r) => [r.id, r.model.id]));
  assert.deepEqual(pick, { T1: 'claude-sonnet-5-5', T2: 'claude-opus-5-5', T3: 'claude-haiku-5-5', T4: 'claude-opus-5-5' });
  assert.equal(rec.tasks[0].reviewer.id, 'claude-sonnet-5-5'); assert.match(rec.tasks[0].why, /separate context/);
  assert.equal(rec.tasks[2].reviewer, null);
  const out = ok(cwd, 'models', 'apply');
  assert.match(out, /T1 +Sonnet 5\.5 \(anthropic\)/);
  const graph = loadTasks(cwd);
  assert.equal(graph.tasks[0].model, 'claude-sonnet-5-5'); assert.equal(graph.tasks[0].reviewModel, 'claude-sonnet-5-5');
  assert.match(fs.readFileSync(path.join(cwd, '.claude/agents/pp-developer.md'), 'utf8'), /^model: sonnet$/m);
  assert.match(fs.readFileSync(path.join(cwd, '.claude/agents/pp-architect.md'), 'utf8'), /^model: opus$/m);
  assert.match(ok(cwd, 'task', 'context', 'T1'), /Requested model: claude-sonnet-5-5.*Independent review: claude-sonnet-5-5/);
});

test('several providers: equally suitable work is spread across providers and review goes to another provider; other providers never reach Claude agent files', async (t) => {
  const cwd = await project(t, 'claude,opencode');
  fs.writeFileSync(path.join(cwd, '.product-planner/models.local.json'), JSON.stringify({ models: [
    { id: 'other-strong', provider: 'otherco', label: 'Other Strong', tier: 'strong', strengths: ['coding', 'review'], price: { input: 2, output: 10, cacheRead: 0.2 }, priceVerified: 'test' },
    { id: 'other-fast', provider: 'otherco', label: 'Other Fast', tier: 'fast', strengths: ['coding', 'checks'], price: null } ] }));
  setPool(cwd, ['claude-sonnet-5-5', 'claude-opus-5-5', 'other-strong', 'other-fast']);
  for (const id of ['T1', 'T2', 'T3', 'T4']) task(cwd, id, { agent: 'developer', risk: 'medium' });
  const rec = recommend(cwd);
  const providers = rec.tasks.map((r) => r.model.provider);
  assert.deepEqual([...new Set(providers)].sort(), ['anthropic', 'otherco']);
  assert.equal(providers.filter((p) => p === 'anthropic').length, 2);
  for (const r of rec.tasks) assert.notEqual(r.reviewer.provider, r.model.provider);
  ok(cwd, 'models', 'apply');
  const roleModel = loadState(cwd).models.developer;
  const agentFile = fs.readFileSync(path.join(cwd, '.claude/agents/pp-developer.md'), 'utf8');
  if (roleModel === 'other-strong') assert.doesNotMatch(agentFile, /^model:/m); else assert.match(agentFile, /^model: sonnet$/m);
  // Unknown models need a provider and tier; unverified prices stay null and are ranked after priced ones.
  assert.throws(() => setPool(cwd, ['mystery']), /--provider/);
  assert.equal(blendedPrice(loadModelCatalog(cwd).models.find((m) => m.id === 'other-fast'), { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 }), null);
});

test('evidence: a model that keeps failing a role in this project is skipped for that role', async (t) => {
  const cwd = await project(t);
  for (const id of ['T1', 'T2', 'T3']) {
    task(cwd, id, { agent: 'developer', risk: 'medium' });
    transition(cwd, id, 'in_progress', { agent: 'developer', model: 'claude-sonnet-5-5' });
    transition(cwd, id, 'review'); transition(cwd, id, 'in_progress'); transition(cwd, id, 'review'); transition(cwd, id, 'done');
  }
  task(cwd, 'T4', { agent: 'developer', risk: 'medium' });
  const r = recommend(cwd).tasks.find((x) => x.id === 'T4');
  assert.notEqual(r.model.id, 'claude-sonnet-5-5'); assert.match(r.why, /skipped Sonnet 5\.5 \(low first-pass rate here\)/);
  assert.match(ok(cwd, 'models', 'stats'), /claude-sonnet-5-5 +developer +done 3 · first pass 0%/);
});

test('plan approve applies the recommended models unless routing is off', async (t) => {
  const cwd = await project(t);
  fs.writeFileSync(path.join(cwd, '.product-planner/request.md'), 'Build a tip calculator.');
  fs.writeFileSync(path.join(cwd, 'plan.json'), JSON.stringify({
    features: [{ id: 'F1', title: 'Tip', status: 'accepted', priority: 'must', release: 'MVP', requests: ['R1'], acceptance: ['tip(100, 15) returns 15'] }],
    tasks: [{ id: 'T1', title: 'Tip', agent: 'developer', risk: 'medium', features: ['F1'], writes: ['tip.js'], acceptance: ['tip(100, 15) returns 15'] }] }));
  ok(cwd, 'plan', 'import', '--file', 'plan.json');
  assert.match(ok(cwd, 'plan', 'approve', '--reason', 'approved in test'), /models applied: T1 Sonnet 5\.5 \(review Sonnet 5\.5\)/);
  assert.equal(loadTasks(cwd).tasks[0].model, 'claude-sonnet-5-5');
  const off = await project(t);
  fs.copyFileSync(path.join(cwd, '.product-planner/request.md'), path.join(off, '.product-planner/request.md'));
  fs.copyFileSync(path.join(cwd, 'plan.json'), path.join(off, 'plan.json'));
  ok(off, 'state', 'set', 'options.modelRouting', 'off'); ok(off, 'plan', 'import', '--file', 'plan.json');
  assert.doesNotMatch(ok(off, 'plan', 'approve', '--reason', 'approved in test'), /models applied/);
  assert.equal(loadTasks(off).tasks[0].model, undefined);
});
