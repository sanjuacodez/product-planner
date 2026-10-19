import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { init } from '../src/init/index.js';
import { loadKit, uninstallTools } from '../src/init/adapters.js';
import { loadState, setByPath } from '../src/state.js';
import { normalise, validateTasks, nextTask, transition, loadTasks } from '../src/tasks.js';
import { buildIndex, searchMemory } from '../src/memory/index.js';
import { parseDuckDuckGo, htmlToText, decodeEntities } from '../src/research/index.js';
import { buildDashboard } from '../src/dashboard/index.js';
const cli = fileURLToPath(new URL('../bin/product-planner.js', import.meta.url));
function project(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-test-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
function run(cwd, ...args) { return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' }); }
function ok(cwd, ...args) { const r = run(cwd, ...args); assert.equal(r.status, 0, r.stderr || r.stdout); return r.stdout; }
const plan = () => ({ epics: [{ id: 'E1', title: 'Core' }], tasks: [
  { id: 'T1', epic: 'E1', title: 'Foundation', acceptance: ['Starts locally'] },
  { id: 'T2', epic: 'E1', title: 'Journey', acceptance: ['Journey works'], dependsOn: ['T1'], priority: 'critical' },
] });

test('all adapters install complete kit, update idempotently and preserve user instructions/data', async (t) => {
  const cwd = project(t); fs.writeFileSync(path.join(cwd, 'AGENTS.md'), '# User instructions\n');
  const kit = loadKit(); assert.equal(kit.agents.length, 10); assert.equal(kit.workflows.length, 5);
  await init(cwd, { tools: 'all', yes: true });
  for (const f of ['.claude/agents/pp-qa.md', '.claude/commands/pp-plan.md', '.agents/skills/pp-plan/SKILL.md', '.gemini/commands/pp/plan.toml', '.opencode/agents/pp-developer.md', '.opencode/commands/pp-build.md', '.cursor/commands/pp-plan.md', '.windsurf/workflows/pp-build.md', '.product-planner/kit/templates/task-plan.json']) assert.ok(fs.existsSync(path.join(cwd, f)), f);
  const state = loadState(cwd); await init(cwd, { tools: 'all', yes: true }); assert.equal(loadState(cwd).createdAt, state.createdAt);
  const instructions = fs.readFileSync(path.join(cwd, 'AGENTS.md'), 'utf8'); assert.equal(instructions.match(/product-planner:start/g).length, 1); assert.match(instructions, /User instructions/);
  fs.writeFileSync(path.join(cwd, '.gemini/commands/pp/custom.toml'), 'description="mine"');
  uninstallTools(cwd); assert.ok(fs.existsSync(path.join(cwd, '.gemini/commands/pp/custom.toml'))); assert.ok(fs.existsSync(path.join(cwd, '.product-planner/state.json'))); assert.equal(fs.readFileSync(path.join(cwd, 'AGENTS.md'), 'utf8').trim(), '# User instructions');
});

test('invalid tool selection makes no project writes', async (t) => {
  const cwd = project(t); await assert.rejects(init(cwd, { tools: 'bad' }), /unknown tool/); assert.deepEqual(fs.readdirSync(cwd), []);
});

test('task graph validates references, cycles, duplicate epics and criteria', () => {
  const p = normalise(plan()); assert.deepEqual(validateTasks(p), []); assert.equal(nextTask(p).id, 'T1');
  p.tasks[0].dependsOn = ['T2']; assert.match(validateTasks(p).join(), /cycle/);
  p.tasks[0].dependsOn = ['T9']; assert.match(validateTasks(p).join(), /unknown dependency/);
  p.tasks[0].dependsOn = 'T2'; assert.match(validateTasks(p).join(), /array/);
  p.tasks[0].dependsOn = []; p.epics.push(p.epics[0]); assert.match(validateTasks(p).join(), /duplicate epic/);
  p.tasks[0].acceptance = ['']; assert.match(validateTasks(p).join(), /acceptance/);
});

test('CLI plan import, dependency checks, QA transitions and completion work end to end', async (t) => {
  const cwd = project(t); ok(cwd, 'init', '--tools', 'generic', '--yes');
  assert.equal(run(cwd, 'state', 'phase', 'build').status, 1);
  fs.writeFileSync(path.join(cwd, 'plan.json'), JSON.stringify(plan())); ok(cwd, 'task', 'add', '--file', 'plan.json'); ok(cwd, 'task', 'validate');
  assert.equal(JSON.parse(ok(cwd, 'task', 'next', '--json')).id, 'T1');
  assert.equal(run(cwd, 'task', 'start', 'T2').status, 1); assert.equal(run(cwd, 'task', 'done', 'T1').status, 1);
  ok(cwd, 'state', 'set', 'options.autoOpenDashboard', 'false'); ok(cwd, 'state', 'step', 'handoff', 'done'); ok(cwd, 'state', 'phase', 'build');
  for (const id of ['T1', 'T2']) { ok(cwd, 'task', 'start', id); ok(cwd, 'task', 'review', id); ok(cwd, 'task', 'done', id, '--note', 'Acceptance verified'); }
  assert.equal(loadState(cwd).phase, 'done'); assert.equal(run(cwd, 'task', 'next', '--json').status, 2);
  ok(cwd, 'task', 'reopen', 'T2'); assert.equal(loadTasks(cwd).tasks[1].completedAt, undefined);
  ok(cwd, 'task', 'block', 'T2', '--reason', 'External account missing'); assert.match(run(cwd, 'task', 'next').stdout, /ALL_BLOCKED/);
  ok(cwd, 'task', 'unblock', 'T2'); assert.equal(JSON.parse(ok(cwd, 'task', 'next', '--json')).id, 'T2');
  ok(cwd, 'task', 'add', '--json', JSON.stringify({ title: 'Docs', acceptance: ['Setup documented'] })); assert.equal(loadTasks(cwd).tasks.length, 3);
});

test('dashboard escapes user content and includes data tables, themes and custom sections', async (t) => {
  const cwd = project(t); await init(cwd, { tools: 'generic' });
  ok(cwd, 'task', 'add', '--json', JSON.stringify({ title: '<script>alert(1)</script>', acceptance: ['Safe rendering'] }));
  fs.writeFileSync(path.join(cwd, '.product-planner/dashboard/api.json'), JSON.stringify({ title: 'Endpoints', type: 'table', columns: ['URL'], rows: [['<img onerror=alert(1)>']] }));
  fs.writeFileSync(path.join(cwd, '.product-planner/research/competitors.json'), JSON.stringify([{ name: 'unsafe', url: 'javascript:alert(1)' }]));
  const html = fs.readFileSync(buildDashboard(cwd), 'utf8'); assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>alert/); assert.doesNotMatch(html, /href="javascript:/); assert.match(html, /View chart data tables/); assert.match(html, /Endpoints/); assert.match(html, /data-theme/);
});

test('keyword memory indexes project docs and retrieves relevant context', async (t) => {
  const cwd = project(t); await init(cwd, { tools: 'generic' });
  fs.writeFileSync(path.join(cwd, '.product-planner/architecture.md'), '# Authentication\n\nUse session cookies for authentication and revoke sessions on logout.');
  const result = await buildIndex(cwd); assert.equal(result.backend, 'bm25'); assert.equal(result.files, 1);
  const matches = await searchMemory(cwd, 'authentication'); assert.match(matches.results[0].text, /session cookies/);
});

test('research parsers decode results and remove executable/page chrome content', () => {
  const html = '<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com">Example &amp; Co</a><a class="result__snippet">A product</a></div>';
  assert.deepEqual(parseDuckDuckGo(html), [{ title: 'Example & Co', url: 'https://example.com', snippet: 'A product' }]);
  assert.equal(htmlToText('<script>bad()</script><h1>Hello</h1><p>World</p>'), '# Hello\nWorld'); assert.equal(decodeEntities('&#999999999;'), '&#999999999;');
});

test('state paths cannot mutate prototypes', () => {
  for (const key of ['__proto__.polluted', 'options.constructor.prototype.polluted', 'a..b']) assert.throws(() => setByPath({}, key, 'true'), /invalid state path/);
  assert.equal({}.polluted, undefined);
});
