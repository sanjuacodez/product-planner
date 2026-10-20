#!/usr/bin/env node
// Benchmark: give the same request to Claude Code with and without a planning kit, answer every
// question with the same scripted reply, then score the result with hidden acceptance tests.
//
//   node bench/run.js --scenario booking-lib --arm planner [--model opus] [--budget 25] [--max-messages 14]
//   arms: plain | planner | tiered | speckit | bmad   (tiered = planner with `models tiered`: Sonnet developer, Haiku QA, delegated tasks)
//   --review adds a blind rubric review by a separate model (extra cost, reported separately).
import { createHash, randomUUID } from 'node:crypto';
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
  budget: { type: 'string', default: '25' }, 'max-messages': { type: 'string', default: '14' }, keep: { type: 'boolean' }, repeat: { type: 'string', default: '1' }, 'dry-run': { type: 'boolean' }, review: { type: 'boolean' },
} });
const scenarioDir = path.join(ROOT, 'scenarios', opt.scenario || '');
if (!opt.scenario || !fs.existsSync(path.join(scenarioDir, 'prompt.md'))) throw new Error('--scenario must name a folder in bench/scenarios');
if (!['plain', 'planner', 'tiered', 'speckit', 'bmad'].includes(opt.arm)) throw new Error('--arm must be plain, planner, tiered, speckit or bmad');
const PLANNER = ['planner', 'tiered'].includes(opt.arm);

const budget = Number(opt.budget), maxMessages = Number(opt['max-messages']), repeats = Number(opt.repeat);
if (!Number.isFinite(budget) || budget <= 0 || !Number.isInteger(maxMessages) || maxMessages < 1 || !Number.isInteger(repeats) || repeats < 1 || repeats > 10) throw new Error('budget must be positive; max-messages and repeat must be positive integers (repeat <= 10)');
if (opt['dry-run']) { console.log(JSON.stringify({ scenario: opt.scenario, arm: opt.arm, model: opt.model, repeats, maxCostUsd: budget * repeats, followUpMessages: fs.existsSync(path.join(scenarioDir, 'changes.json')) ? JSON.parse(fs.readFileSync(path.join(scenarioDir, 'changes.json'))).length : 0, productOwner: fs.existsSync(path.join(scenarioDir, 'facts.md')) ? 'haiku answers questions from facts.md (small extra cost, reported separately)' : null, seededRepository: fs.existsSync(path.join(scenarioDir, 'seed')), platformChecks: fs.existsSync(path.join(scenarioDir, 'quality.json')), blindReview: !!opt.review, launchesModels: false })); process.exit(0); }
if (repeats > 1) {
  for (let i = 0; i < repeats; i++) {
    const args = process.argv.slice(2).filter((v, n, all) => v !== '--repeat' && all[n - 1] !== '--repeat' && !v.startsWith('--repeat='));
    const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...args], { stdio: 'inherit' });
    if (run.status !== 0) process.exit(run.status || 1);
  }
  process.exit(0);
}
const digestFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((e) => e.isDirectory() ? digestFiles(path.join(dir, e.name)) : [[path.relative(PKG, path.join(dir, e.name)), fs.readFileSync(path.join(dir, e.name), 'utf8')]]);
const kitDigest = createHash('sha256').update(JSON.stringify([...digestFiles(path.join(PKG, 'kit')), ...digestFiles(path.join(PKG, 'src'))])).digest('hex').slice(0, 12);

// The scripted user: identical for every arm. It never reveals the hidden tests.
// Harness 2 adds the full-scope sentence so no arm can defer part of the request by "recommendation".
const HARNESS = 2;
const APPROVE = "If you are asking for approval, it is approved: build the full requested scope now, without splitting or deferring any part, and continue until everything is built and verified.";
const REPLY = `Use your recommendations. ${APPROVE}`;
// Scenarios with facts.md have a product owner: questions are answered from the fact sheet by a small model.
const FACTS = fs.existsSync(path.join(scenarioDir, 'facts.md')) ? fs.readFileSync(path.join(scenarioDir, 'facts.md'), 'utf8') : null;
const RESPONDER_MODEL = 'haiku';
const TOOLS = ['Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'TodoWrite', 'Task', 'Agent', 'Skill',
  'Bash(node:*)', 'Bash(npm:*)', 'Bash(npx:*)', 'Bash(git:*)', 'Bash(ls:*)', 'Bash(mkdir:*)', 'Bash(cat:*)', 'Bash(bash:*)', 'Bash(sh:*)',
  'Bash(.specify/scripts/bash/*)', 'Bash(product-planner:*)', 'Bash(pp:*)', 'Bash(uv:*)', 'Bash(uvx:*)',
  'Bash(php:*)', 'Bash(composer:*)', 'Bash(vendor/bin/*)'];
const SPECKIT = 'git+https://github.com/github/spec-kit.git@v1.2.1';
const BMAD = 'bmad-method@6.12.4';

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const ws = fs.mkdtempSync(path.join(os.tmpdir(), `bench-${opt.scenario}-${opt.arm}-`));
const out = path.join(ROOT, 'results', `${opt.scenario}-${opt.arm}-${stamp}-${randomUUID().slice(0, 6)}`);
fs.mkdirSync(out, { recursive: true });
const sh = (cmd, args, extra = {}) => spawnSync(cmd, args, { cwd: ws, encoding: 'utf8', ...extra });
const env = { ...process.env };

// ---------- existing product (seed) and arm setup ----------
sh('git', ['init', '-q']);
const seed = path.join(scenarioDir, 'seed');
if (fs.existsSync(seed)) { fs.cpSync(seed, ws, { recursive: true }); sh('git', ['add', '-A']); sh('git', ['commit', '-qm', 'existing product']); }
if (PLANNER) {
  const bin = path.join(ws, '.bench-bin');
  fs.mkdirSync(bin);
  for (const name of ['product-planner', 'pp']) fs.symlinkSync(path.join(PKG, 'bin', 'product-planner.js'), path.join(bin, name));
  env.PATH = `${bin}${path.delimiter}${env.PATH}`;
  const pp = (...a) => { const r = sh(process.execPath, [path.join(PKG, 'bin', 'product-planner.js'), ...a]); if (r.status) throw new Error(r.stderr); };
  pp('init', '--tools', 'claude', '--yes');
  pp('state', 'set', 'options.autoOpenDashboard', 'false');
  if (opt.arm === 'tiered') pp('models', 'tiered');
  fs.appendFileSync(path.join(ws, '.gitignore'), '.bench-bin/\n');
} else if (opt.arm === 'speckit') {
  const r = sh('uvx', ['--from', SPECKIT, 'specify', 'init', '--here', '--force', '--non-interactive', '--integration', 'claude', '--script', 'sh']);
  if (r.status) throw new Error(`spec-kit init failed: ${r.stderr}`);
} else if (opt.arm === 'bmad') {
  const r = sh('npx', ['-y', BMAD, 'install', '--directory', '.', '--modules', 'bmm', '--tools', 'claude-code', '--yes']);
  if (r.status) throw new Error(`BMAD install failed: ${r.stderr}`);
}
sh('git', ['add', '-A']); sh('git', ['commit', '-qm', 'bench setup', '--allow-empty']);

const prompt = fs.readFileSync(path.join(scenarioDir, 'prompt.md'), 'utf8').trim();
// spec-kit has no intent routing: its documented minimum flow is specify -> plan -> tasks -> implement.
// BMAD-METHOD 6.12's documented one-session path is bmad-build (spec, checkpoint, implement, review).
const script = opt.arm === 'speckit'
  ? [`/speckit-specify ${prompt}`, '/speckit-plan', '/speckit-tasks', '/speckit-implement']
  : opt.arm === 'bmad' ? [`/bmad-build ${prompt}`] : [prompt];
const changes = fs.existsSync(path.join(scenarioDir, 'changes.json')) ? JSON.parse(fs.readFileSync(path.join(scenarioDir, 'changes.json'), 'utf8')) : [];
script.push(...changes);

// ---------- conversation loop ----------
const turns = [];
let session = null, cost = 0, responderCost = 0, ownerAnswers = 0;
const costByModel = {}; // from Claude Code's modelUsage: main session and sub-agents
/** The product owner: answers only what was asked, from facts.md; never mentions tests. */
function ownerReply(agentText) {
  const ask = `You are the product owner replying to a developer. Answer the questions in the developer's message using ONLY the facts below, quoting numbers, codes and rules exactly. Like a real owner, when you answer a question about a topic (for example earning points, redeeming, refunds, tiers), also mention the other facts on that same topic. Do not bring up topics the developer did not ask about. For a question the facts do not answer, reply "Use your recommendation" for that question. Do not mention tests. Reply in plain text, no tools.\n\n<facts>\n${FACTS}\n</facts>\n\n<developer_message>\n${agentText.slice(-6000)}\n</developer_message>`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-owner-'));
  const r = spawnSync('claude', ['-p', ask, '--output-format', 'json', '--model', RESPONDER_MODEL, '--max-turns', '1', '--disallowedTools', 'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'Task', 'Agent'], { cwd: dir, encoding: 'utf8', timeout: 5 * 60 * 1000 });
  fs.rmSync(dir, { recursive: true, force: true });
  let res; try { res = JSON.parse(r.stdout); } catch { return REPLY; }
  responderCost += res.total_cost_usd || 0; ownerAnswers++;
  return `${(res.result || '').trim() || 'Use your recommendations.'}\n\n${APPROVE}`;
}
let stopReason = 'message_limit';
// Waiting for the user: ends with a question, uses a hand-over phrase, or lists several questions near the end.
const asksSomething = (text) => /\?\s*$|\bapprov|\brepl(y|ies)\b|\bconfirm\b|which option|let me know|should i\b|\bproceed\b|\bwant me to\b|once you('ve| have)? (answer|decid|confirm)|your answers?\b|answer (these|the|my) questions|before i (write|build|start|implement)/i.test(text.slice(-800))
  || (text.slice(-4000).match(/\?(\s|\*|\)|$)/g) || []).length >= 3;
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
  const last = turns.at(-1)?.result || '';
  const message = queue.length ? queue.shift() : FACTS && asksSomething(last) ? ownerReply(last) : REPLY;
  const args = ['-p', message, '--output-format', 'json', '--model', opt.model, '--max-turns', '80',
    '--allowedTools', ...TOOLS, '--disallowedTools', 'WebSearch', 'WebFetch', '--max-budget-usd', String(Math.max(0.001, budget - cost))];
  if (session) args.push('--resume', session);
  const t0 = Date.now();
  const r = spawnSync('claude', args, { cwd: ws, env, encoding: 'utf8', timeout: 45 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 });
  let res; try { res = JSON.parse(r.stdout); } catch { res = { is_error: true, result: (r.stdout || '') + (r.stderr || ''), usage: {} }; }
  session = res.session_id || session;
  cost += res.total_cost_usd || 0;
  for (const [m, u] of Object.entries(res.modelUsage || {})) costByModel[m] = Number(((costByModel[m] || 0) + (u.costUSD || 0)).toFixed(4));
  const u = res.usage || {};
  turns.push({ message: message.slice(0, 200), result: res.result, cost: res.total_cost_usd || 0, ms: Date.now() - t0, turns: res.num_turns, error: res.is_error || false, subtype: res.subtype,
    tokens: { input: u.input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, output: u.output_tokens || 0 } });
  fs.writeFileSync(path.join(out, 'transcript.json'), JSON.stringify(turns, null, 2));
  console.log(`[${opt.arm}] message ${i + 1}: $${(res.total_cost_usd || 0).toFixed(2)} · ${res.num_turns} turns · ${res.subtype || ''}`);
  // A subscription usage limit is not the arm's failure: stop and mark it so the run is redone after the reset.
  if (/hit your (session|usage|weekly|daily) limit|usage limit reached/i.test(String(res.result || ''))) { stopReason = 'usage_limit'; break; }
  // Hitting the per-message turn cap is not an error: the scripted user simply continues the conversation.
  if (res.subtype === 'error_max_turns' && session && cost < budget) continue;
  if (res.is_error || r.error || r.status !== 0) { stopReason = res.subtype?.includes('budget') ? 'budget_exhausted' : 'host_error'; break; }
  if (queue.length) continue;
  if (PLANNER) { if (plannerDone(res.result || '')) { stopReason = 'completed'; break; } continue; }
  if (res.subtype === 'error_max_turns') continue;
  if (!asksSomething(res.result || '')) { stopReason = 'completed'; break; }
}

if (cost >= budget && stopReason === 'message_limit') stopReason = 'budget_exhausted';

// ---------- hidden acceptance tests (copied only now) ----------
const hidden = path.join(ws, '.bench-hidden');
fs.mkdirSync(hidden, { recursive: true });
fs.copyFileSync(path.join(scenarioDir, 'hidden-tests.js'), path.join(hidden, 'hidden.test.mjs'));
// Helper files the hidden tests load relative to themselves (for example PHP stubs).
if (fs.existsSync(path.join(scenarioDir, 'hidden'))) fs.cpSync(path.join(scenarioDir, 'hidden'), path.join(hidden, 'hidden'), { recursive: true });
const test = spawnSync(process.execPath, ['--test', '--test-reporter=tap', path.join(hidden, 'hidden.test.mjs')], { cwd: ws, encoding: 'utf8', timeout: 120000 });
const count = (k) => Number((test.stdout.match(new RegExp(`^# ${k} (\\d+)`, 'm')) || [])[1] || 0);
// Pass counts per test-name prefix ("prompt:", "R12:", "change 3:"), so stated and owner-only facts are scored separately.
const groups = {};
for (const m of test.stdout.matchAll(/^(not ok|ok) \d+ - (.+)$/gm)) {
  const head = m[2].includes(':') ? m[2].slice(0, m[2].indexOf(':')).replace(/\([^)]*\)/g, '').trim().toLowerCase() : '';
  const g = /^r\d+$/.test(head) ? 'rules' : head || 'other';
  groups[g] ??= { pass: 0, total: 0 }; groups[g].total++; if (m[1] === 'ok') groups[g].pass++;
}
const quality = runQuality(ws);
const review = opt.review ? blindReview(ws) : null;
const sum = (k) => turns.reduce((a, t) => a + t.tokens[k], 0);
const result = {
  kitDigest, status: stopReason, stages: script.length, budgetUsd: budget, measurement: 'Claude Code reported usage and API-price cost; not subscription billing',
  scenario: opt.scenario, arm: opt.arm, model: opt.model, date: new Date().toISOString(),
  hiddenExitCode: test.status,
  hidden: { pass: count('pass'), fail: count('fail'), total: count('tests'), groups },
  harness: HARNESS, quality, review, owner: FACTS ? { answers: ownerAnswers, model: RESPONDER_MODEL, costUsd: Number(responderCost.toFixed(4)) } : undefined,
  costUsd: Number(cost.toFixed(4)), costByModel, minutes: Number((turns.reduce((a, t) => a + t.ms, 0) / 60000).toFixed(1)),
  messages: turns.length, scriptedReplies: Math.max(0, turns.length - script.length), agentTurns: turns.reduce((a, t) => a + (t.turns || 0), 0),
  tokens: { input: sum('input'), cacheWrite: sum('cacheWrite'), cacheRead: sum('cacheRead'), output: sum('output') },
  ownTests: fs.existsSync(path.join(ws, 'package.json')) || fs.readdirSync(ws).some((f) => /test/i.test(f)),
  workspace: ws,
};
result.tokens.total = result.tokens.input + result.tokens.cacheWrite + result.tokens.cacheRead + result.tokens.output;
fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2));
fs.writeFileSync(path.join(out, 'hidden-tests.tap'), test.stdout + test.stderr);
spawnSync('tar', ['-czf', path.join(out, 'workspace.tgz'), '--exclude', '.git', '--exclude', 'node_modules', '--exclude', 'vendor', '-C', ws, '.']);
if (!opt.keep) fs.rmSync(ws, { recursive: true, force: true });
console.log(JSON.stringify(result, null, 2));

// ---------- quality checks (after the build; never shown to the agent) ----------
function runQuality(dir) {
  const results = [];
  // Committed secrets: common key formats anywhere in the delivered files.
  const SECRET = /(AKIA[0-9A-Z]{16}|sk-(?:ant-|live_|proj-)?[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|ghp_[A-Za-z0-9]{36}|xox[baprs]-[A-Za-z0-9-]{10,})/;
  const skip = new Set(['.git', 'node_modules', 'vendor', '.bench-hidden', '.bench-bin', '_bmad', '.specify', '.claude']);
  const files = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => skip.has(e.name) ? [] : e.isDirectory() ? files(path.join(d, e.name)) : [path.join(d, e.name)]);
  const leaks = files(dir).filter((f) => fs.statSync(f).size < 1e6 && SECRET.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(dir, f));
  results.push({ name: 'no committed secrets', pass: !leaks.length, errors: leaks.length, details: leaks.join(', ') });
  // The agent's own test suite, if it left one.
  const pkg = (() => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch { return null; } })();
  const composer = (() => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'composer.json'), 'utf8')); } catch { return null; } })();
  const suite = pkg?.scripts?.test && !/no test specified/.test(pkg.scripts.test) ? ['npm', ['test', '--silent']] : composer?.scripts?.test ? ['composer', ['test', '--no-interaction']] : null;
  if (suite) {
    const r = spawnSync(suite[0], suite[1], { cwd: dir, encoding: 'utf8', timeout: 180000 });
    const tail = (r.stdout + r.stderr).split('\n').filter((l) => /^# (pass|fail)|pass|fail|OK|error/i.test(l)).slice(-3).join(' ');
    results.push({ name: 'own test suite passes', pass: r.status === 0, errors: r.status === 0 ? 0 : 1, details: `${suite[0]} test: ${tail}`.slice(0, 300) });
  } else results.push({ name: 'own test suite passes', pass: false, errors: 1, details: 'no npm or composer test script' });
  // Static analysis when semgrep is installed; otherwise reported as not run, never as passed.
  if (spawnSync('semgrep', ['--version'], { encoding: 'utf8' }).status === 0) {
    const r = spawnSync('semgrep', ['scan', '--config', 'auto', '--json', '--quiet', '--metrics', 'off', '--exclude', '.bench-hidden', '--exclude', 'node_modules', '--exclude', 'vendor', dir], { encoding: 'utf8', timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
    let n = null; try { n = JSON.parse(r.stdout).results.length; } catch { /* unparsable */ }
    results.push({ name: 'semgrep findings', pass: n === 0, errors: n ?? 1, details: n == null ? 'semgrep output unreadable' : `${n} findings` });
  } else results.push({ name: 'semgrep findings', pass: null, errors: null, details: 'semgrep not installed: not run' });
  // Scenario-specific platform checks (quality.json): tools are installed once into BENCH_TOOLS.
  const spec = path.join(scenarioDir, 'quality.json');
  if (fs.existsSync(spec)) {
    const q = JSON.parse(fs.readFileSync(spec, 'utf8'));
    const tools = process.env.BENCH_TOOLS || path.join(os.homedir(), '.cache', 'pp-bench-tools');
    fs.mkdirSync(tools, { recursive: true });
    const sub = (a) => a.replaceAll('${BENCH_TOOLS}', tools).replaceAll('${WORKSPACE}', dir).replaceAll('${SCENARIO}', scenarioDir);
    for (const step of q.setup || []) {
      const r = spawnSync(sub(step.cmd), (step.args || []).map(sub), { cwd: tools, encoding: 'utf8', timeout: 600000 });
      if (r.status !== 0) { results.push({ name: 'quality tool setup', pass: null, errors: null, details: (r.stderr || r.stdout).slice(-300) }); return results; }
    }
    for (const c of q.checks || []) {
      const r = spawnSync(sub(c.cmd), (c.args || []).map(sub), { cwd: c.cwd === 'workspace' || !c.cwd ? dir : sub(c.cwd), encoding: 'utf8', timeout: 300000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, BENCH_TOOLS: tools, WORKSPACE: dir } });
      const line = (r.stdout || '').trim().split('\n').reverse().find((l) => l.startsWith('{'));
      let parsed = null; try { parsed = JSON.parse(line); } catch { /* exit code only */ }
      results.push(parsed ? { name: c.name, pass: !!parsed.pass, errors: parsed.errors ?? null, details: (typeof parsed.details === 'object' ? JSON.stringify(parsed.details) : String(parsed.details ?? '')).slice(0, 300) } : { name: c.name, pass: r.status === 0, errors: r.status === 0 ? 0 : null, details: ((r.stdout || '') + (r.stderr || '')).slice(-300) });
    }
  }
  return results;
}

// ---------- optional blind review (rubric scores; the reviewer is not told which arm built it) ----------
function blindReview(dir) {
  const rubric = 'Review the delivered project in the current directory as a senior engineer. Ignore .git, node_modules, vendor, .bench-hidden, .bench-bin and any planning-tool folders (_bmad, .specify, .product-planner, .claude). Score 1-5 each: correctness risks (5 = none found), maintainability, tests (meaningful coverage of the stated behaviour), documentation, security. Reply with ONLY a JSON object: {"correctness":n,"maintainability":n,"tests":n,"documentation":n,"security":n,"notes":"<=3 sentences"}';
  const r = spawnSync('claude', ['-p', rubric, '--output-format', 'json', '--model', 'sonnet', '--max-turns', '30', '--allowedTools', 'Read', 'Glob', 'Grep'], { cwd: dir, encoding: 'utf8', timeout: 20 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 });
  let res; try { res = JSON.parse(r.stdout); } catch { return { error: 'review failed' }; }
  let scores = null; try { scores = JSON.parse((res.result || '').match(/\{[\s\S]*\}/)[0]); } catch { /* keep null */ }
  return { model: 'sonnet', costUsd: Number((res.total_cost_usd || 0).toFixed(4)), scores };
}
