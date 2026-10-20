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
import { deliveryWaves, roadmapSections } from '../src/dashboard/render.js';
import { registerServer, unregisterServer, serverCommand, browserStatus } from '../src/browser/index.js';
const cli = fileURLToPath(new URL('../bin/product-planner.js', import.meta.url));
function project(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-test-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
function run(cwd, ...args) { return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' }); }
function ok(cwd, ...args) { const r = run(cwd, ...args); assert.equal(r.status, 0, r.stderr || r.stdout); return r.stdout; }
function verify(cwd, id) {
  const task = loadTasks(cwd).tasks.find((t) => t.id === id);
  const report = { criteria: task.acceptance.map((criterion) => ({ criterion, status: 'pass', evidence: 'Fixture acceptance checked' })), reviewer: 'fixture-qa', reviewEvidence: 'Fixture reviewed', checks: { 'test suite': 'Fixture regression checks pass', integration: 'Fixture integration checks pass', 'security and data integrity review': 'Fixture reviewed' } };
  const file = path.join(cwd, 'verification-report.json'); fs.writeFileSync(file, JSON.stringify(report)); ok(cwd, 'task', 'verify', id, '--file', file);
}
const plan = () => ({ epics: [{ id: 'E1', title: 'Core' }], tasks: [
  { id: 'T1', epic: 'E1', title: 'Foundation', acceptance: ['Starts locally'] },
  { id: 'T2', epic: 'E1', title: 'Journey', acceptance: ['Journey works'], dependsOn: ['T1'], priority: 'critical' },
] });

test('all adapters install complete kit, update idempotently and preserve user instructions/data', async (t) => {
  const cwd = project(t); fs.writeFileSync(path.join(cwd, 'AGENTS.md'), '# User instructions\n');
  const kit = loadKit(); assert.equal(kit.agents.length, 10); assert.equal(kit.workflows.length, 7);
  await init(cwd, { tools: 'all', yes: true });
  for (const f of ['.claude/agents/pp-qa.md', '.claude/commands/pp-plan.md', '.claude/commands/pp-replan.md', '.gemini/commands/pp/replan.toml', '.agents/skills/pp-plan/SKILL.md', '.gemini/commands/pp/plan.toml', '.opencode/agents/pp-developer.md', '.opencode/commands/pp-build.md', '.cursor/commands/pp-plan.md', '.windsurf/workflows/pp-build.md', '.product-planner/kit/templates/task-plan.json']) assert.ok(fs.existsSync(path.join(cwd, f)), f);
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
  for (const id of ['T1', 'T2']) { ok(cwd, 'task', 'start', id); ok(cwd, 'task', 'review', id); verify(cwd, id); ok(cwd, 'task', 'done', id, '--note', 'Acceptance verified'); }
  assert.equal(loadState(cwd).phase, 'build'); // Final acceptance audit is now a separate completion gate.
  assert.equal(run(cwd, 'state', 'phase', 'done').status, 1); assert.equal(run(cwd, 'task', 'next', '--json').status, 2);
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

test('tasks record the agent and AI model that worked on them and the dashboard shows them', async (t) => {
  const cwd = project(t); ok(cwd, 'init', '--tools', 'generic', '--yes');
  fs.writeFileSync(path.join(cwd, 'plan.json'), JSON.stringify(plan())); ok(cwd, 'task', 'add', '--file', 'plan.json');
  ok(cwd, 'state', 'set', 'models.developer', 'planned-model-x');
  ok(cwd, 'task', 'start', 'T1', '--agent', 'pp-developer', '--model', 'claude-opus-5-5');
  ok(cwd, 'task', 'review', 'T1', '--agent', 'developer', '--model', 'claude-opus-5-5');
  verify(cwd, 'T1'); ok(cwd, 'task', 'done', 'T1', '--agent', 'qa', '--model', 'claude-sonnet-5-5', '--note', 'Verified');
  assert.deepEqual(loadTasks(cwd).tasks[0].workedBy.map((w) => `${w.agent}/${w.model}`), ['developer/claude-opus-5-5', 'qa/claude-sonnet-5-5']);
  assert.match(ok(cwd, 'task', 'show', 'T1'), /worked by: developer \(claude-opus-5-5\), qa \(claude-sonnet-5-5\)/);
  const html = fs.readFileSync(buildDashboard(cwd), 'utf8');
  for (const tab of ['overview', 'tasks', 'roadmap', 'activity']) assert.match(html, new RegExp(`data-panel="${tab}"`));
  for (const view of ['table', 'board', 'epics', 'sequence']) assert.match(html, new RegExp(`data-view-panel="${view}"`));
  assert.match(html, /<b>QA<\/b> · Sonnet 5\.5/); assert.match(html, /model id claude-sonnet-5-5/); assert.match(html, /planned-model-x <small>\(planned\)/); assert.match(html, /Agents and AI models/);
});

test('delivery waves follow dependencies and roadmap headings become lanes', () => {
  const waves = deliveryWaves(normalise(plan()).tasks); assert.deepEqual(waves.map((w) => w.map((x) => x.id)), [['T1'], ['T2']]);
  const r = roadmapSections('# Roadmap\nIntro\n## MVP\n- a\n<!-- hint -->\n## Later\n- b');
  assert.equal(r.intro, 'Intro'); assert.deepEqual(r.lanes, [{ title: 'MVP', body: '- a' }, { title: 'Later', body: '- b' }]);
});

test('browser setup registers a pinned MCP server per tool without clobbering existing config', async (t) => {
  const cwd = project(t); await init(cwd, { tools: 'generic' });
  fs.mkdirSync(path.join(cwd, '.gemini')); fs.writeFileSync(path.join(cwd, '.gemini/settings.json'), JSON.stringify({ theme: 'dark' }));
  fs.writeFileSync(path.join(cwd, '.mcp.json'), JSON.stringify({ mcpServers: { playwright: { command: 'mine' } } }));
  const cmd = serverCommand('1.2.3', { headless: true }); assert.deepEqual(cmd, ['npx', '-y', '@playwright/mcp@1.2.3', '--browser', 'chromium', '--headless']);
  const r = registerServer(cwd, ['claude', 'gemini', 'opencode', 'codex'], cmd);
  assert.deepEqual(r.map((x) => x.action), ['kept', 'written', 'written', 'manual']);
  const gemini = JSON.parse(fs.readFileSync(path.join(cwd, '.gemini/settings.json'), 'utf8')); assert.equal(gemini.theme, 'dark'); assert.equal(gemini.mcpServers.playwright.args[1], '@playwright/mcp@1.2.3');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(cwd, 'opencode.json'), 'utf8')).mcp.playwright.command, cmd);
  assert.equal(browserStatus(cwd).servers.length, 3);
  unregisterServer(cwd); assert.equal(browserStatus(cwd).servers.length, 0);
  ok(cwd, 'browser', 'use', 'host', '--detail', 'Built-in editor browser'); assert.equal(loadState(cwd).options.browser.source, 'host');
});

test('feature register gates readiness and task validation checks MVP feature coverage', async (t) => {
  const cwd = project(t); ok(cwd, 'init', '--tools', 'generic', '--yes');
  assert.equal(run(cwd, 'feature', 'check').status, 1);
  ok(cwd, 'feature', 'add', '--json', JSON.stringify({ features: [
    { id: 'F1', title: 'Book a session', priority: 'must', status: 'proposed', openQuestions: ['Can students cancel?'] },
    { id: 'F2', title: 'Payments', priority: 'could' },
  ] }));
  assert.match(run(cwd, 'feature', 'check').stdout, /still proposed[\s\S]*needs acceptance|still proposed/);
  ok(cwd, 'feature', 'set', 'F1', 'status', 'accepted'); ok(cwd, 'feature', 'set', 'F2', 'status', 'deferred');
  assert.match(run(cwd, 'feature', 'check').stdout, /needs acceptance criteria[\s\S]*open question: Can students cancel/);
  ok(cwd, 'feature', 'add', '--json', JSON.stringify({ id: 'F1', acceptance: ['Booked slot is no longer offered'], openQuestions: [], assumptions: ['Cancellation is out of scope'] }));
  assert.match(ok(cwd, 'feature', 'check'), /ready: 1 accepted MVP/);
  assert.equal(run(cwd, 'feature', 'set', 'F1', 'priority', 'urgent').status, 1);
  fs.writeFileSync(path.join(cwd, 'plan.json'), JSON.stringify(plan())); ok(cwd, 'task', 'add', '--file', 'plan.json');
  assert.match(run(cwd, 'task', 'validate').stdout, /F1 \(Book a session\): accepted MVP feature has no tasks/);
  ok(cwd, 'task', 'add', '--json', JSON.stringify({ title: 'Booking flow', features: ['F1'], acceptance: ['Booking works'] })); ok(cwd, 'task', 'validate');
  ok(cwd, 'task', 'add', '--json', JSON.stringify({ title: 'Bad ref', features: ['F9'], acceptance: ['x'] })); assert.match(run(cwd, 'task', 'validate').stdout, /unknown feature F9/);
  const html = fs.readFileSync(buildDashboard(cwd), 'utf8'); assert.match(html, /Features and scope/); assert.match(html, /Cancellation is out of scope/);
});

test('automatic mode routes plain requests and can be switched off and on', async (t) => {
  const cwd = project(t); ok(cwd, 'init', '--tools', 'claude,cursor', '--yes');
  const read = (f) => fs.readFileSync(path.join(cwd, f), 'utf8');
  for (const f of ['CLAUDE.md', 'AGENTS.md', '.cursor/rules/product-planner.mdc']) assert.match(read(f), /Automatic mode \(on\)[\s\S]*`pp-replan`/, f);
  assert.match(ok(cwd, 'auto', 'off'), /automatic mode off/);
  assert.doesNotMatch(read('CLAUDE.md'), /Automatic mode/); assert.equal(read('CLAUDE.md').match(/product-planner:start/g).length, 1);
  ok(cwd, 'init', '--tools', 'claude', '--yes'); assert.doesNotMatch(read('AGENTS.md'), /Automatic mode/);
  ok(cwd, 'auto', 'on'); assert.match(read('AGENTS.md'), /Automatic mode \(on\)/); assert.match(ok(cwd, 'auto'), /on/);
});

test('replanning updates unfinished tasks, removes unneeded ones and never rewrites done work', async (t) => {
  const cwd = project(t); ok(cwd, 'init', '--tools', 'generic', '--yes');
  fs.writeFileSync(path.join(cwd, 'plan.json'), JSON.stringify({ epics: [{ id: 'E1', title: 'Core' }], tasks: [
    { id: 'T1', epic: 'E1', title: 'Foundation', acceptance: ['Starts'] },
    { id: 'T2', epic: 'E1', title: 'Journey', acceptance: ['Works'], dependsOn: ['T1'] },
    { id: 'T3', epic: 'E1', title: 'Old idea', acceptance: ['x'], dependsOn: ['T1'] },
  ] })); ok(cwd, 'task', 'add', '--file', 'plan.json');
  for (const s of ['start', 'review', 'done']) { if (s === 'done') verify(cwd, 'T1'); ok(cwd, 'task', s, 'T1'); }
  assert.match(run(cwd, 'task', 'update', 'T1', '--json', '{"title":"x"}').stderr, /follow-up task/);
  assert.match(run(cwd, 'task', 'update', 'T2', '--json', '{"status":"done"}').stderr, /cannot update status/);
  ok(cwd, 'task', 'update', 'T2', '--json', JSON.stringify({ title: 'Journey with reschedule', acceptance: ['Works', 'Can reschedule'] }), '--note', 'replan: reschedule');
  assert.equal(loadTasks(cwd).tasks[1].acceptance.length, 2);
  assert.equal(run(cwd, 'task', 'update', 'T2', '--json', '{"dependsOn":["T9"]}').status, 1);
  assert.equal(run(cwd, 'task', 'remove', 'T3').status, 1);
  ok(cwd, 'task', 'remove', 'T3', '--reason', 'replan: dropped'); assert.equal(loadTasks(cwd).tasks.length, 2);
  assert.match(run(cwd, 'task', 'remove', 'T1', '--reason', 'x').stderr, /only todo or blocked/);
  const html = fs.readFileSync(buildDashboard(cwd), 'utf8'); assert.match(html, /removed: Old idea/); assert.match(html, /updated title, acceptance: replan: reschedule/);
});

test('check finds uncovered requirements, vague criteria and unfilled templates; context briefs one task', async (t) => {
  const cwd = project(t); ok(cwd, 'init', '--tools', 'generic', '--yes');
  const dir = path.join(cwd, '.product-planner');
  ok(cwd, 'feature', 'add', '--json', JSON.stringify({ features: [{ id: 'F1', title: 'Booking', priority: 'must', status: 'accepted', acceptance: ['Double booking throws SLOT_UNAVAILABLE'], story: 'As a student I book a lesson.' }] }));
  fs.writeFileSync(path.join(dir, 'prd.md'), '# PRD\n- FR-001 (F1): book a free slot\n- FR-002 (F1): reject overlaps with SLOT_UNAVAILABLE\n- FR-003: export (removed in replan)\n');
  fs.writeFileSync(path.join(dir, 'architecture.md'), '# Architecture\n## Modules\n<!-- Replace with concrete project evidence, requirements or decisions. -->\n');
  fs.writeFileSync(path.join(dir, 'decisions.md'), '- F1 uses an in-memory store\n');
  fs.writeFileSync(path.join(cwd, 'plan.json'), JSON.stringify({ epics: [{ id: 'E1', title: 'Core' }], tasks: [
    { id: 'T1', epic: 'E1', title: 'Booking core (FR-001)', features: ['F1'], acceptance: ['Booking is fast'], risk: 'high' },
    { id: 'T2', epic: 'E1', title: 'Docs', acceptance: ['README lists commands', 'list prints No todos when empty'], dependsOn: ['T1'] },
  ] })); ok(cwd, 'task', 'add', '--file', 'plan.json');
  const r = JSON.parse(ok(cwd, 'check', '--json'));
  assert.deepEqual(r.errors, []);
  const w = r.warnings.join('\n');
  assert.match(w, /FR-002 in prd.md is not referenced/); assert.doesNotMatch(w, /FR-001|FR-003/);
  assert.match(w, /T1: vague acceptance "Booking is fast"/); assert.doesNotMatch(w, /No todos/); assert.match(w, /T2: not linked to a feature/);
  assert.match(w, /architecture.md: still has unfilled/); assert.match(w, /request.md missing/);
  assert.deepEqual(r.stats.highRisk, ['T1']);
  const brief = ok(cwd, 'task', 'context', 'T1');
  assert.match(brief, /# T1: Booking core/); assert.match(brief, /risk high/); assert.match(brief, /Feature F1: Booking/); assert.match(brief, /FR-001 \(F1\)/); assert.match(brief, /F1 uses an in-memory store/); assert.match(brief, /architecture.md: # Architecture · ## Modules/);
  assert.equal(run(cwd, 'task', 'update', 'T2', '--json', '{"risk":"extreme"}').status, 1);
});

test('QA loop warning appears after repeated returns', async (t) => {
  let out = '';
  const t2 = project(t); ok(t2, 'init', '--tools', 'generic', '--yes');
  ok(t2, 'task', 'add', '--json', JSON.stringify({ title: 'Tricky', acceptance: ['Works'] })); ok(t2, 'task', 'start', 'T1');
  for (let i = 0; i < 3; i++) { ok(t2, 'task', 'review', 'T1'); transition(t2, 'T1', 'in_progress', { note: 'QA failed' }); }
  assert.equal(loadTasks(t2).tasks[0].qaReturns, 3);
  ok(t2, 'task', 'review', 'T1'); out = ok(t2, 'task', 'start', 'T1');
  assert.match(out, /QA has returned T1 4 times/);
});

test('usage hook attributes transcript tokens to active tasks and phases; hooks install and uninstall cleanly', async (t) => {
  const cwd = project(t);
  fs.mkdirSync(path.join(cwd, '.claude')); fs.writeFileSync(path.join(cwd, '.claude/settings.json'), JSON.stringify({ permissions: { allow: ['Bash(ls:*)'] } }));
  ok(cwd, 'init', '--tools', 'claude', '--yes'); ok(cwd, 'init', '--tools', 'claude', '--yes');
  const settings = JSON.parse(fs.readFileSync(path.join(cwd, '.claude/settings.json'), 'utf8'));
  assert.deepEqual(settings.permissions, { allow: ['Bash(ls:*)'] }); assert.equal(settings.hooks.PostToolUse.length, 1); assert.equal(settings.hooks.Stop.length, 1);
  ok(cwd, 'task', 'add', '--json', JSON.stringify({ title: 'Build', acceptance: ['Works'] }));
  const tr = path.join(cwd, 'session.jsonl');
  const msg = (id, out) => JSON.stringify({ type: 'assistant', message: { id, model: 'claude-test', usage: { input_tokens: 1, cache_creation_input_tokens: 10, cache_read_input_tokens: 100, output_tokens: out } } });
  const hook = (event, command) => spawnSync(process.execPath, [cli, 'usage', 'hook'], { cwd, encoding: 'utf8', input: JSON.stringify({ hook_event_name: event, session_id: 's1', transcript_path: tr, cwd, tool_input: { command } }) });
  fs.writeFileSync(tr, [msg('m1', 5), msg('m1', 5), msg('m2', 7)].join('\n') + '\n');
  hook('PostToolUse', 'ls -la'); assert.equal(fs.existsSync(path.join(cwd, '.product-planner/usage.jsonl')), false);
  hook('PostToolUse', 'product-planner task start T1'); ok(cwd, 'task', 'start', 'T1'); hook('PostToolUse', 'product-planner task start T1');
  fs.appendFileSync(tr, msg('m3', 20) + '\n');
  fs.mkdirSync(path.join(cwd, 'session', 'subagents'), { recursive: true }); fs.writeFileSync(path.join(cwd, 'session/subagents/agent-1.jsonl'), msg('s1', 30) + '\n');
  hook('Stop');
  const lines = fs.readFileSync(path.join(cwd, '.product-planner/usage.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(lines.length, 3); assert.equal(lines[0].phase, 'init'); assert.equal(lines[0].tokens.output, 12);
  assert.deepEqual(lines[1].tasks, ['T1']); assert.equal(lines[1].tokens.output + lines[2].tokens.output, 50); assert.equal(lines[1].tokens.cacheRead + lines[2].tokens.cacheRead, 200);
  assert.match(ok(cwd, 'usage'), /T1 +272 tokens/);
  assert.match(fs.readFileSync(buildDashboard(cwd), 'utf8'), /Token usage/);
  uninstallTools(cwd);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(cwd, '.claude/settings.json'), 'utf8')), { permissions: { allow: ['Bash(ls:*)'] } });
});

test('task briefs preserve product context, multiline rules and exact ID boundaries', async (t) => {
  const cwd = project(t); await init(cwd, { tools: 'generic' });
  const dir = path.join(cwd, '.product-planner');
  const write = (name, text) => fs.writeFileSync(path.join(dir, name), text);
  write('concept.md', '# Concept\n## Goal\nHelp tutors book lessons.\n## Non-goals\nNo payments.\n## Constraints\nOffline only.');
  write('prd.md', '# PRD\n## FR-1 (F1): Booking\nBook a free slot.\n\nReject overlaps with SLOT_UNAVAILABLE.\n### Timing\nUse UTC.\n## FR-10 (F10): Payments\nUNRELATED_PAYMENT\n');
  write('architecture.md', '# Architecture\n## Security\nNever persist secrets.\n## Booking F1\nUse booking.js.\n\nUpdates must be atomic.\n## Payments F10\nUNRELATED_MODULE\n');
  write('decisions.md', '# Decisions\n- T1 uses memory.\n  Revisit after persistence is requested.\n- T10 UNRELATED_DECISION\n\n## Global policy\nPreserve public API compatibility.\n');
  ok(cwd, 'feature', 'add', '--json', JSON.stringify({ id: 'F1', title: 'Booking', status: 'accepted', priority: 'must', acceptance: ['Reject overlaps'] }));
  ok(cwd, 'task', 'add', '--json', JSON.stringify({ id: 'T1', title: 'Core', features: ['F1'], acceptance: ['FR-1 is satisfied'] }));
  const brief = ok(cwd, 'task', 'context', 'T1');
  for (const text of ['Help tutors book lessons.', 'No payments.', 'Offline only.', 'Reject overlaps with SLOT_UNAVAILABLE.', 'Use UTC.', 'Never persist secrets.', 'Updates must be atomic.', 'Revisit after persistence is requested.', 'Preserve public API compatibility.', 'request.md']) assert.ok(brief.includes(text), text);
  assert.doesNotMatch(brief, /UNRELATED_/);
  const checked = JSON.parse(ok(cwd, 'check', '--json'));
  assert.ok(checked.warnings.some((w) => w.startsWith('FR-10 in prd.md')));
  ok(cwd, 'task', 'update', 'T1', '--json', JSON.stringify({ acceptance: ['FR-10 is satisfied'] }));
  const rechecked = JSON.parse(ok(cwd, 'check', '--json'));
  assert.ok(rechecked.warnings.some((w) => w.startsWith('FR-1 in prd.md')));
});

test('task ready lists every eligible task without starting or launching workers', async (t) => {
  const cwd = project(t); await init(cwd, { tools: 'generic' });
  fs.writeFileSync(path.join(cwd, 'plan.json'), JSON.stringify(plan())); ok(cwd, 'task', 'add', '--file', 'plan.json');
  ok(cwd, 'task', 'add', '--json', JSON.stringify({ title: 'Independent docs', priority: 'high', acceptance: ['Commands documented'] }));
  assert.deepEqual(JSON.parse(ok(cwd, 'task', 'ready', '--json')).map((x) => x.id), ['T3', 'T1']);
  assert.match(ok(cwd, 'task', 'ready'), /ownership/);
  ok(cwd, 'task', 'start', 'T1');
  assert.deepEqual(JSON.parse(ok(cwd, 'task', 'ready', '--json')).map((x) => x.id), ['T3']);
  ok(cwd, 'task', 'block', 'T3', '--reason', 'Waiting on docs source');
  assert.deepEqual(JSON.parse(ok(cwd, 'task', 'ready', '--json')), []);
});

test('briefs keep table column context, dependency evidence and requested model precedence', async (t) => {
  const cwd = project(t); await init(cwd, { tools: 'generic' });
  const dir = path.join(cwd, '.product-planner');
  fs.writeFileSync(path.join(cwd, 'plan.json'), JSON.stringify(plan())); ok(cwd, 'task', 'add', '--file', 'plan.json');
  for (const sub of ['start', 'review', 'done']) { if (sub === 'done') verify(cwd, 'T1'); ok(cwd, 'task', sub, 'T1', '--note', 'API exported by core.js; node --test passed'); }
  fs.writeFileSync(path.join(dir, 'prd.md'), '# PRD\n| Requirement | Rule |\n|---|---|\n| FR-2 | Reject stale input |\n| FR-20 | UNRELATED_TABLE_ROW |\n');
  ok(cwd, 'task', 'update', 'T2', '--json', JSON.stringify({ acceptance: ['FR-2 is satisfied'] }));
  ok(cwd, 'state', 'set', 'models.default', 'default-model');
  ok(cwd, 'state', 'set', 'models.developer', 'role-model');
  let brief = ok(cwd, 'task', 'context', 'T2');
  assert.match(brief, /Requested model: role-model/);
  assert.match(brief, /\| Requirement \| Rule \|/);
  assert.match(brief, /FR-2 \| Reject stale input/);
  assert.doesNotMatch(brief, /UNRELATED_TABLE_ROW/);
  assert.match(brief, /T1 Foundation \[done\]/); assert.match(brief, /Starts locally/);
  assert.match(brief, /API exported by core.js; node --test passed/);
  assert.match(brief, /concept.md missing/);
  ok(cwd, 'task', 'update', 'T2', '--json', '{"model":"task-model"}');
  brief = ok(cwd, 'task', 'context', 'T2'); assert.match(brief, /Requested model: task-model/);
  assert.deepEqual(loadTasks(cwd).tasks[1].workedBy, []);
});
