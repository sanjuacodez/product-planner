#!/usr/bin/env node
// Benchmark: give the same request to Claude Code with and without a planning kit, answer every
// question with the same scripted reply, then score the result with hidden acceptance tests.
//
//   node bench/run.js --scenario booking-lib --arm planner [--model opus] [--budget 25] [--max-messages 14]
//   arms: plain | planner | speckit
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(ROOT, '..');
const { values: opt } = parseArgs({ options: {
  scenario: { type: 'string' }, arm: { type: 'string' }, model: { type: 'string', default: 'opus' },
  budget: { type: 'string', default: '25' }, 'max-messages': { type: 'string', default: '14' }, keep: { type: 'boolean' },
} });
const scenarioDir = path.join(ROOT, 'scenarios', opt.scenario || '');
if (!opt.scenario || !fs.existsSync(path.join(scenarioDir, 'prompt.md'))) throw new Error('--scenario must name a folder in bench/scenarios');
if (!['plain', 'planner', 'speckit'].includes(opt.arm)) throw new Error('--arm must be plain, planner or speckit');

// The scripted user: identical for every arm. It never reveals the hidden tests.
const REPLY = "Use your recommendations. If you are asking for approval, it is approved: continue until everything is built and verified.";
const TOOLS = ['Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'TodoWrite', 'Task', 'Skill',
  'Bash(node:*)', 'Bash(npm:*)', 'Bash(npx:*)', 'Bash(git:*)', 'Bash(ls:*)', 'Bash(mkdir:*)', 'Bash(cat:*)', 'Bash(bash:*)', 'Bash(sh:*)',
  'Bash(.specify/scripts/bash/*)', 'Bash(product-planner:*)', 'Bash(pp:*)'];
const SPECKIT = 'git+https://github.com/github/spec-kit.git@v1.2.1';

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const ws = fs.mkdtempSync(path.join(os.tmpdir(), `bench-${opt.scenario}-${opt.arm}-`));
const out = path.join(ROOT, 'results', `${opt.scenario}-${opt.arm}-${stamp}`);
fs.mkdirSync(out, { recursive: true });
const sh = (cmd, args, extra = {}) => spawnSync(cmd, args, { cwd: ws, encoding: 'utf8', ...extra });
const env = { ...process.env };

// ---------- arm setup ----------
sh('git', ['init', '-q']);
if (opt.arm === 'planner') {
  const bin = path.join(ws, '.bench-bin');
  fs.mkdirSync(bin);
  for (const name of ['product-planner', 'pp']) fs.symlinkSync(path.join(PKG, 'bin', 'product-planner.js'), path.join(bin, name));
  env.PATH = `${bin}${path.delimiter}${env.PATH}`;
  const pp = (...a) => { const r = sh(process.execPath, [path.join(PKG, 'bin', 'product-planner.js'), ...a]); if (r.status) throw new Error(r.stderr); };
  pp('init', '--tools', 'claude', '--yes');
  pp('state', 'set', 'options.autoOpenDashboard', 'false');
  fs.appendFileSync(path.join(ws, '.gitignore'), '.bench-bin/\n');
} else if (opt.arm === 'speckit') {
  const r = sh('uvx', ['--from', SPECKIT, 'specify', 'init', '--here', '--force', '--non-interactive', '--integration', 'claude', '--script', 'sh']);
  if (r.status) throw new Error(`spec-kit init failed: ${r.stderr}`);
}
sh('git', ['add', '-A']); sh('git', ['commit', '-qm', 'bench setup', '--allow-empty']);

const prompt = fs.readFileSync(path.join(scenarioDir, 'prompt.md'), 'utf8').trim();
// spec-kit has no intent routing: its documented minimum flow is specify -> plan -> tasks -> implement.
const script = opt.arm === 'speckit'
  ? [`/speckit-specify ${prompt}`, '/speckit-plan', '/speckit-tasks', '/speckit-implement']
  : [prompt];

// ---------- conversation loop ----------
const turns = [];
let session = null, cost = 0;
const budget = Number(opt.budget), maxMessages = Number(opt['max-messages']);
const asksSomething = (text) => /\?\s*$|\bapprov|\breply\b|\bconfirm\b|which option|let me know|should i\b|\bproceed\b|\bwant me to\b/i.test(text.slice(-600));
// Planner arm: finished when the phase is done, or the build has nothing left except blocked tasks.
const plannerDone = (text) => {
  const dir = path.join(ws, '.product-planner');
  const st = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
  if (st.phase === 'done') return true;
  const tasks = JSON.parse(fs.readFileSync(path.join(dir, 'tasks.json'), 'utf8')).tasks;
  const open = tasks.filter((t) => t.status !== 'done');
  return st.phase === 'build' && tasks.length > 0 && open.every((t) => t.status === 'blocked') && !asksSomething(text);
};
let queue = [...script];
for (let i = 0; i < maxMessages && cost < budget; i++) {
  const message = queue.length ? queue.shift() : REPLY;
  const args = ['-p', message, '--output-format', 'json', '--model', opt.model, '--max-turns', '80',
    '--allowedTools', ...TOOLS, '--disallowedTools', 'WebSearch', 'WebFetch', '--max-budget-usd', String(Math.max(1, budget - cost))];
  if (session) args.push('--resume', session);
  const t0 = Date.now();
  const r = spawnSync('claude', args, { cwd: ws, env, encoding: 'utf8', timeout: 45 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 });
  let res; try { res = JSON.parse(r.stdout); } catch { res = { is_error: true, result: (r.stdout || '') + (r.stderr || ''), usage: {} }; }
  session = res.session_id || session;
  cost += res.total_cost_usd || 0;
  const u = res.usage || {};
  turns.push({ message: message.slice(0, 200), result: res.result, cost: res.total_cost_usd || 0, ms: Date.now() - t0, turns: res.num_turns, error: res.is_error || false, subtype: res.subtype,
    tokens: { input: u.input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, output: u.output_tokens || 0 } });
  fs.writeFileSync(path.join(out, 'transcript.json'), JSON.stringify(turns, null, 2));
  console.log(`[${opt.arm}] message ${i + 1}: $${(res.total_cost_usd || 0).toFixed(2)} · ${res.num_turns} turns · ${res.subtype || ''}`);
  if (queue.length) continue;
  if (opt.arm === 'planner') { if (plannerDone(res.result || '')) break; continue; }
  if (res.subtype === 'error_max_turns') continue;
  if (!asksSomething(res.result || '')) break;
}

// ---------- hidden acceptance tests (copied only now) ----------
const hidden = path.join(ws, '.bench-hidden');
fs.mkdirSync(hidden, { recursive: true });
fs.copyFileSync(path.join(scenarioDir, 'hidden-tests.js'), path.join(hidden, 'hidden.test.mjs'));
const test = spawnSync(process.execPath, ['--test', '--test-reporter=tap', path.join(hidden, 'hidden.test.mjs')], { cwd: ws, encoding: 'utf8', timeout: 120000 });
const count = (k) => Number((test.stdout.match(new RegExp(`^# ${k} (\\d+)`, 'm')) || [])[1] || 0);
const sum = (k) => turns.reduce((a, t) => a + t.tokens[k], 0);
const result = {
  scenario: opt.scenario, arm: opt.arm, model: opt.model, date: new Date().toISOString(),
  hidden: { pass: count('pass'), fail: count('fail'), total: count('tests') },
  costUsd: Number(cost.toFixed(4)), minutes: Number((turns.reduce((a, t) => a + t.ms, 0) / 60000).toFixed(1)),
  messages: turns.length, scriptedReplies: Math.max(0, turns.length - script.length), agentTurns: turns.reduce((a, t) => a + (t.turns || 0), 0),
  tokens: { input: sum('input'), cacheWrite: sum('cacheWrite'), cacheRead: sum('cacheRead'), output: sum('output') },
  ownTests: fs.existsSync(path.join(ws, 'package.json')) || fs.readdirSync(ws).some((f) => /test/i.test(f)),
  workspace: ws,
};
result.tokens.total = result.tokens.input + result.tokens.cacheWrite + result.tokens.cacheRead + result.tokens.output;
fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2));
fs.writeFileSync(path.join(out, 'hidden-tests.tap'), test.stdout + test.stderr);
spawnSync('tar', ['-czf', path.join(out, 'workspace.tgz'), '--exclude', '.git', '--exclude', 'node_modules', '-C', ws, '.']);
if (!opt.keep) fs.rmSync(ws, { recursive: true, force: true });
console.log(JSON.stringify(result, null, 2));
