import path from 'node:path';
import { parseArgs } from 'node:util';
import { PKG_ROOT, STATE_DIR, readJson, nowIso } from './util/fs.js';
import { init } from './init/index.js';
import { TOOLS, uninstallTools, installTools } from './init/adapters.js';
import { loadState, saveState, loadConfig, setByPath, appendLog, PHASES, PLANNING_STEPS, isInitialised, configPath } from './state.js';
import { loadTasks, saveTasks, validateTasks, summary, nextTask, readyTasks, transition, addTask, getTask, agentName, updateTask, removeTask, LOOP_LIMIT, STATUSES, natural, mergeTaskPlan, saveTaskPlan, readinessWarnings, epicCompleted, reviewEpic } from './tasks.js';
import { buildDashboard, openInBrowser, watchDashboard } from './dashboard/index.js';
import { search, fetchPage, SETUP_OPTIONS } from './research/index.js';
import { buildIndex, searchMemory, setupVector, memoryStatus } from './memory/index.js';
import { doctor } from './doctor.js';
import { bindUsage, runHook, readUsage, summarizeUsage } from './usage.js';
import { executionBatch } from './execution.js';
import { captureTask, taskFreshness } from './evidence.js';
import { verificationPolicy, verificationTemplate, recordVerification } from './verification.js';
import { auditTemplate, recordAudit, auditStatus } from './audit.js';
import { planningProfile, approvePlan } from './planning.js';
import { checkPlan, taskContext } from './check.js';
import { loadFeatures, validateFeatures, readiness, coverage, sortedFeatures, upsertFeatures, setFeature, requestCoverage } from './features.js';
import { requestItems } from './request.js';
import { loadCatalog, loadProfile, detectProfiles, setProfiles, verifyProfile, editGate, runGates } from './profile.js';
import { syncClaudeAgents } from './init/adapters.js';
import { BROWSER_OPTIONS, TARGETS, browserStatus, recordChoice, setupBrowser, unregisterServer } from './browser/index.js';
import { writeJson } from './util/fs.js';

const HELP = `product-planner – multi-agent product planning & build kit

Usage: product-planner <command> [options]

  init [--tools a,b|all] [--yes]      Install agents/workflows for your AI tools and create ${STATE_DIR}/
  uninstall                           Remove installed tool files (keeps ${STATE_DIR}/ project data)
  status [--json]                     Phase, planning progress and task summary
  dashboard [--open] [--watch] [--no-refresh]   Generate product-dashboard.html (optionally open / keep rebuilding)
  task list [--status s] [--json]     List tasks
  task batch [--json]                 Propose a bounded batch with disjoint read/write ownership
  task capture|freshness <id> [--json]  Snapshot source evidence or detect changed sources
  task policy <id> [--json]           Risk-based verification requirements
  task complete <id> --file report.json  Review, record verification and mark done in one step (--agent/--model/--note)
  task verify <id> --template [--out f] | --file f   Write a report skeleton, or record passing acceptance and review evidence
  audit template [--out f] | check --file f | status   Final acceptance gate over the request and accepted features
  task ready [--json]                 All dependency-ready candidates (check write ownership before parallel work)
  task next [--json]                  Next ready task (deps satisfied, by priority)
  task show <id>                      Show one task
  task start|review|done|block|unblock|reopen <id> [--note "…"] [--reason "…"] [--agent name] [--model id]
  task add --json '{…}' | --file f    Add one task (or {"epics":[],"tasks":[]} file to merge)
  task update <id> --json '{…}' [--note "…"]   Replanning: revise a task that is not done
  task remove <id> --reason "…"       Replanning: drop a todo/blocked task nobody depends on
  task context <id>                   Compact brief for one task (acceptance, features, requirements, deps)
  task validate                       Check tasks.json for errors and feature coverage
  profile catalog | detect | show     Quality profiles: platform and regulatory checks, repository signals, the selection
  profile set <ids> --because "…"     Select profiles; their gates need architecture decisions and tasks (check enforces)
  profile verify <id> --sources "…" --note "…"   Record checking a profile against its official sources
  profile gate <id> --command "…" | --remove --reason "…"   Adjust a gate for this project
  profile run [ids]                   Run automated gates (static analysis, standards, audits) and record results
  request list [--json]               Request statements (R1, R2, …) and the features or notFeatures they map to
  plan profile                        Planning depth, canonical documents and quality invariants
  plan import --file plan.json        Import features, epics and tasks in one validated step, then run check
  plan approve --reason "…"           After the user's approval: lock the plan and move to build (check must pass)
  epic review E# --evidence "…"       Record the end-of-epic integration check
  check [--json]                      Analyse the whole plan without a model: coverage, vague criteria, gaps (exit 1 on errors)
  feature list [--json] | show <id>   The feature register (agreed scope) from the planning interview
  feature add --json '{…}' | --file f Add/update features ({"features":[…]} or one feature)
  feature set <id> <status|priority|release|title|story> <value>
  feature check                       Is the scope ready for requirements/tasks? (exit 1 if not)
  state get [key] | set <key> <value> | phase <phase> | step <step> <status> | product --name --tagline --summary
  log "<message>" [--agent a] [--model id] [--task id]   Append to the activity log
  research search "<query>" [--max n] [--json]   Key-less web search (DuckDuckGo)
  research fetch <url> [--max-chars n] [--json]  Fetch a page as readable text
  research options                    Print free research setup options
  memory index [--paths p1,p2] | search "<q>" [--k n] | setup | status   Project memory (BM25, optional local vectors)
  browser status | options           Browser access available to agents (host browser, MCP servers, cached browsers)
  browser use host|none [--detail "…"]   Record that the AI tool's own browser (or no browser) is used
  browser setup [--tools a,b] [--engine chromium] [--headless] [--version x] [--skip-install] [--force]
                                      After user approval: install free Playwright MCP + Chromium and register it
  browser remove                      Remove the Playwright MCP entry from this project's tool configs
  usage [summary] [--json] | bind --file transcript --task T# | hook              Token usage per task/phase (recorded by the Claude Code hook)
  models show | tiered | inherit      Planned models per role; tiered = developer on Sonnet, QA on Haiku, each task delegated
  auto on|off|status                  Automatic mode: agents start pp-plan/pp-replan/pp-resume from plain requests
  doctor                              Environment checks (node, git, web, memory)
  version | help

Set PP_DEBUG=1 for stack traces. Short alias: pp`;

export async function main(argv) {
  const cwd = process.cwd();
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case undefined: case 'help': case '-h': case '--help': console.log(HELP); return;
    case 'version': case '-v': case '--version': console.log(readJson(path.join(PKG_ROOT, 'package.json')).version); return;
    case 'init': return cmdInit(cwd, rest);
    case 'uninstall': { const removed = uninstallTools(cwd); console.log(removed.length ? `removed/cleaned:\n  ${removed.join('\n  ')}` : 'nothing to remove'); return; }
    case 'status': return cmdStatus(cwd, rest);
    case 'dashboard': return cmdDashboard(cwd, rest);
    case 'task': return cmdTask(cwd, rest);
    case 'plan': return cmdPlan(cwd, rest);
    case 'feature': return cmdFeature(cwd, rest);
    case 'epic': {
      requireInit(cwd);
      const { values, positionals } = args(rest, { evidence: { type: 'string' }, agent: { type: 'string' }, model: { type: 'string' } });
      if (positionals[0] !== 'review' || !positionals[1]) throw new Error('usage: epic review E# --evidence "integration checks and results" [--agent a --model m]');
      const epic = reviewEpic(cwd, positionals[1], values);
      console.log(`${epic.id} increment review recorded`); refreshDashboard(cwd); return;
    }
    case 'audit': {
      requireInit(cwd);
      const { values, positionals } = args(rest, { file: { type: 'string' }, out: { type: 'string' }, json: { type: 'boolean' } });
      let result;
      if (positionals[0] === 'template' && values.out) { console.log(`audit template written to ${writeOut(cwd, values.out, auditTemplate(cwd))}`); return; }
      if (positionals[0] === 'template') result = auditTemplate(cwd);
      else if (positionals[0] === 'status') result = auditStatus(cwd);
      else if (positionals[0] === 'check' && values.file) { result = recordAudit(cwd, readJson(path.resolve(cwd, values.file))); refreshDashboard(cwd); }
      else throw new Error('usage: audit template [--out file] | check --file report.json | status');
      console.log(JSON.stringify(result, null, 2)); return;
    }
    case 'request': {
      requireInit(cwd);
      if (rest[0] !== 'list') throw new Error('usage: request list [--json]');
      const items = requestItems(cwd);
      if (rest.includes('--json')) { console.log(JSON.stringify(items, null, 2)); return; }
      if (!items.length) { console.log('request.md is empty: save the user\'s request verbatim first'); return; }
      const cov = requestCoverage(loadFeatures(cwd), items);
      for (const r of items) console.log(`${r.id}  ${cov.mapped.has(r.id) ? '→ ' + cov.mapped.get(r.id).join(', ') : '(not mapped)'}\n    ${r.text}`);
      return;
    }
    case 'profile': return cmdProfile(cwd, rest);
    case 'models': return cmdModels(cwd, rest);
    case 'auto': return cmdAuto(cwd, rest);
    case 'usage': return cmdUsage(cwd, rest);
    case 'check': { requireInit(cwd); const r = checkPlan(cwd); if (rest.includes('--json')) console.log(JSON.stringify(r, null, 2)); else { for (const e of r.errors) console.log(`error: ${e}`); for (const w of r.warnings) console.log(`warning: ${w}`); console.log(`${r.errors.length ? 'not ready' : 'ok'}: ${r.stats.tasks} tasks, ${r.stats.features} features, ${r.stats.requirements} requirement IDs (${r.stats.uncoveredRequirements} without tasks)${r.stats.highRisk.length ? `, high-risk: ${r.stats.highRisk.join(', ')}` : ''}`); } if (r.errors.length) process.exitCode = 1; return; }
    case 'state': return cmdState(cwd, rest);
    case 'log': return cmdLog(cwd, rest);
    case 'research': return cmdResearch(cwd, rest);
    case 'memory': return cmdMemory(cwd, rest);
    case 'browser': return cmdBrowser(cwd, rest);
    case 'doctor': { const checks = await doctor(cwd); for (const c of checks) console.log(`${c.ok ? '✔' : '✖'} ${c.name.padEnd(12)} ${c.detail}`); if (checks.some((c) => !c.ok)) process.exitCode = 1; return; }
    default: throw new Error(`unknown command "${cmd}". Run product-planner help`);
  }
}

function args(rest, options, allowPositionals = true) {
  return parseArgs({ args: rest, options, allowPositionals, strict: true });
}
/** Write a JSON template for the agent to fill in, creating directories, so no shell redirection is needed. */
function writeOut(cwd, file, value) { const full = path.resolve(cwd, file); writeJson(full, value); return path.relative(cwd, full); }
function requireInit(cwd) { if (!isInitialised(cwd)) throw new Error(`not initialised here – run \`product-planner init\` in the project root`); }
function refreshDashboard(cwd) { try { return buildDashboard(cwd); } catch (e) { if (process.env.PP_DEBUG) console.error(e); return null; } }

async function cmdInit(cwd, rest) {
  const { values } = args(rest, { tools: { type: 'string' }, yes: { type: 'boolean', short: 'y' } });
  const r = await init(cwd, values);
  console.log(`${r.fresh ? 'Initialised' : 'Updated'} product-planner in ${cwd}`);
  console.log(`Tools: ${r.tools.map((t) => `${t} (${TOOLS[t].label.split(' via')[0]})`).join(', ')}`);
  if (r.detected.length) console.log(`Detected on this machine: ${r.detected.join(', ')}`);
  console.log(`Wrote ${r.written.length} files.\n\nNext: open your AI tool in this folder and run /pp-plan (or say "run pp-plan").`);
  console.log(`The dashboard will be generated at ${loadConfig(cwd).dashboard.output} when planning finishes.`);
}

function cmdStatus(cwd, rest) {
  requireInit(cwd);
  const { values } = args(rest, { json: { type: 'boolean' } });
  const state = loadState(cwd); const t = loadTasks(cwd); const s = summary(t);
  const next = nextTask(t);
  if (values.json) { console.log(JSON.stringify({ state, summary: s, next }, null, 2)); return; }
  console.log(`${state.product.name || '(unnamed product)'}${state.product.tagline ? ' – ' + state.product.tagline : ''}`);
  console.log(`Phase: ${state.phase}`);
  console.log('Planning: ' + PLANNING_STEPS.map((k) => `${k}=${state.planning[k]}`).join(' '));
  console.log(`Tasks: ${s.total} total · ${s.done} done (${s.pct}%) · ${s.in_progress} in progress · ${s.review} review · ${s.ready} ready · ${s.blocked} blocked`);
  if (next) console.log(`Next: ${next.id} ${next.title} [${next.priority}, ${next.agent}]`);
  const blocked = t.tasks.filter((x) => x.status === 'blocked');
  for (const b of blocked) console.log(`  blocked ${b.id}: ${b.blockedReason}`);
}

function cmdDashboard(cwd, rest) {
  requireInit(cwd);
  const { values } = args(rest, { open: { type: 'boolean' }, watch: { type: 'boolean' }, 'no-refresh': { type: 'boolean' } });
  if (values['no-refresh']) { const c = loadConfig(cwd); c.dashboard.autoRefreshSeconds = 0; writeJson(configPath(cwd), c); }
  const out = buildDashboard(cwd);
  console.log(`dashboard written: ${path.relative(cwd, out)}`);
  if (values.open) openInBrowser(out);
  if (values.watch) { console.log('watching for changes… (Ctrl+C to stop)'); watchDashboard(cwd, (f) => console.log(`${nowIso()} rebuilt ${path.relative(cwd, f)}`)); return new Promise(() => {}); }
}

/** plan profile | plan import --file f: features, epics and tasks in one validated step, then the plan check. */
function cmdPlan(cwd, rest) {
  requireInit(cwd);
  const { values, positionals } = args(rest, { file: { type: 'string' }, json: { type: 'boolean' }, reason: { type: 'string' } });
  if (positionals[0] === 'profile') { console.log(JSON.stringify(planningProfile(cwd), null, 2)); return; }
  if (positionals[0] === 'approve') {
    const r = approvePlan(cwd, { reason: values.reason, check: checkPlan });
    for (const w of r.warnings) console.log(`warning: ${w}`);
    console.log(`plan approved and locked (${r.lock.reason}); phase: build`);
    const out = refreshDashboard(cwd); if (out && loadState(cwd).options?.autoOpenDashboard !== false) openInBrowser(out);
    return;
  }
  if (positionals[0] !== 'import' || !values.file) throw new Error('usage: plan profile | plan import --file plan.json | plan approve --reason "…"');
  const src = readJson(path.resolve(cwd, values.file));
  if (!src) throw new Error(`cannot read ${values.file}`);
  const plan = mergeTaskPlan(cwd, src); // validate tasks before writing anything
  if (src.features?.length || src.notFeatures?.length) { const r = upsertFeatures(cwd, src.features || [], { notFeatures: src.notFeatures }); console.log(`features: ${r.added} added, ${r.updated} updated, ${r.total} total`); }
  saveTaskPlan(cwd, plan, src);
  console.log(`tasks: ${plan.imported.length} added, ${plan.merged.tasks.length} total in ${plan.merged.epics.length} epics`);
  const r = checkPlan(cwd);
  for (const e of r.errors) console.log(`error: ${e}`); for (const w of r.warnings) console.log(`warning: ${w}`);
  console.log(r.errors.length ? 'plan check: not ready' : 'plan check: ok');
  if (r.errors.length) process.exitCode = 1;
  refreshDashboard(cwd);
}

/** Quality profiles: which platform and regulatory checks apply, verified, planned and run. */
function cmdProfile(cwd, rest) {
  requireInit(cwd);
  const { values, positionals } = args(rest, { because: { type: 'string' }, sources: { type: 'string' }, note: { type: 'string' }, command: { type: 'string' }, remove: { type: 'boolean' }, reason: { type: 'string' }, json: { type: 'boolean' } });
  const [sub, ...ids] = positionals;
  const out = (v, text) => { if (values.json) console.log(JSON.stringify(v, null, 2)); else console.log(text); };
  switch (sub) {
    case 'catalog': { const c = loadCatalog(cwd); return out(c, `${c.profiles.map((p) => `${p.id.padEnd(22)} ${p.kind.padEnd(10)} ${p.title}\n${' '.repeat(34)}applies when: ${p.appliesWhen}${p.lastVerified ? '' : ' (catalog entry not verified: check its sources)'}`).join('\n')}\n\nAsk during the interview:\n${c.questions.map((q) => `- ${q}`).join('\n')}`); }
    case 'detect': { const d = detectProfiles(cwd); return out(d, d.length ? d.map((x) => `${x.id}: ${x.reasons.join('; ')}`).join('\n') + '\nSuggestions from repository signals: confirm them in the interview, then profile set.' : 'no repository signals; decide from the interview answers (profile catalog lists the questions)'); }
    case 'set': { if (!ids.length) throw new Error('usage: profile set <id> [<id> …] --because "…"'); const p = setProfiles(cwd, ids, values.because); refreshDashboard(cwd); return out(p, `selected: ${p.selected.map((x) => x.id).join(', ')}\ngates: ${p.gates.map((g) => `${g.id} (${g.type})`).join(', ')}\nNext: verify each profile against its sources, write one architecture decision per gate, and link gates to tasks.`); }
    case 'verify': { const s = verifyProfile(cwd, ids[0], values); refreshDashboard(cwd); return out(s, `${s.id} verified ${s.verified.at.slice(0, 10)} against ${s.verified.sources.length} source(s)`); }
    case 'gate': { const g = editGate(cwd, ids[0], values); refreshDashboard(cwd); return out(g, values.remove ? `${ids[0]} removed` : `${g.id} command: ${g.command}`); }
    case 'run': { const r = runGates(cwd, ids); refreshDashboard(cwd); if (r.some((x) => !x.pass)) process.exitCode = 1; return out(r, r.length ? r.map((x) => `${x.pass ? 'pass' : 'FAIL'} ${x.id}: ${x.command}${x.pass ? '' : `\n${x.output.split('\n').slice(-15).join('\n')}`}`).join('\n') : 'no automated gates selected'); }
    case 'show': case undefined: { const p = loadProfile(cwd); if (!p) return out(null, 'no quality profile selected; run profile detect and profile catalog'); return out(p, `${p.selected.map((x) => `${x.id}${x.verified ? ` (verified ${x.verified.at.slice(0, 10)})` : ' (not verified)'}: ${x.because}`).join('\n')}\n\n${p.gates.map((g) => `${g.id.padEnd(26)} ${g.type.padEnd(9)} ${g.title}${p.results[g.id] ? ` [last run: ${p.results[g.id].pass ? 'pass' : 'fail'}]` : ''}`).join('\n')}${p.removed.length ? `\n\nremoved: ${p.removed.map((r) => `${r.id} (${r.reason})`).join('; ')}` : ''}`); }
    default: throw new Error('usage: profile catalog | detect | set <ids> --because "…" | verify <id> --sources "…" --note "…" | gate <id> --command "…" | --remove --reason "…" | run [ids] | show');
  }
}

/** Model presets for delegated work. tiered: implementation on Sonnet, QA on Haiku, each task in a fresh
 * sub-agent context; planning, architecture, coordination and high-risk tasks stay on the session model. */
const MODEL_PRESETS = {
  tiered: { models: { developer: 'sonnet', qa: 'haiku' }, delegateTasks: true },
  inherit: { models: {}, delegateTasks: false },
};
function cmdModels(cwd, rest) {
  requireInit(cwd);
  const [sub] = rest;
  const st = loadState(cwd);
  if (!sub || sub === 'show') {
    console.log(`planned models: ${Object.keys(st.models || {}).length ? Object.entries(st.models).map(([k, v]) => `${k}=${v}`).join(', ') : 'none (every role inherits the session model)'}`);
    console.log(`delegate each build task to sub-agents: ${st.options?.delegateTasks ? 'yes' : 'no'}`);
    return;
  }
  const preset = MODEL_PRESETS[sub];
  if (!preset) throw new Error(`usage: models show | ${Object.keys(MODEL_PRESETS).join(' | ')}`);
  st.models = { ...preset.models };
  st.options.delegateTasks = preset.delegateTasks;
  saveState(cwd, st);
  const n = syncClaudeAgents(cwd, st.models).length;
  appendLog(cwd, { type: 'note', message: `models preset ${sub}: ${JSON.stringify(st.models)}, delegateTasks ${preset.delegateTasks}` });
  console.log(`models: ${sub}${Object.keys(st.models).length ? ` (${Object.entries(st.models).map(([k, v]) => `${k}=${v}`).join(', ')})` : ''}; delegate tasks: ${preset.delegateTasks ? 'yes' : 'no'}${n ? `; ${n} Claude Code agent files updated` : ''}`);
  refreshDashboard(cwd);
}

function cmdTask(cwd, rest) {
  requireInit(cwd);
  const [sub, id] = rest;
  const { values, positionals } = args(rest.slice(1), { status: { type: 'string' }, json: { type: ['add', 'update'].includes(sub) ? 'string' : 'boolean' }, note: { type: 'string' }, reason: { type: 'string' }, agent: { type: 'string' }, model: { type: 'string' }, file: { type: 'string' }, template: { type: 'boolean' }, out: { type: 'string' } });
  const t = loadTasks(cwd);
  const show = (task) => console.log(`${task.id}  [${task.status}] ${task.title}\n  epic: ${task.epic || '-'} · agent: ${task.agent}${task.model ? ' · planned model: ' + task.model : ''} · priority: ${task.priority}${task.estimate ? ' · estimate: ' + task.estimate : ''}${task.dependsOn.length ? '\n  depends on: ' + task.dependsOn.join(', ') : ''}${task.description ? '\n  ' + task.description.replace(/\n/g, '\n  ') : ''}${task.acceptance.length ? '\n  acceptance:\n' + task.acceptance.map((a) => '   - ' + a).join('\n') : ''}${task.workedBy.length ? '\n  worked by: ' + task.workedBy.map((w) => `${w.agent}${w.model ? ' (' + w.model + ')' : ''}`).join(', ') : ''}${task.blockedReason ? '\n  BLOCKED: ' + task.blockedReason : ''}${task.notes.length ? '\n  notes:\n' + task.notes.map((n) => `   - ${n.ts.slice(0, 16)} ${n.agent ? n.agent + (n.model ? ' (' + n.model + ')' : '') + ': ' : ''}${n.text}`).join('\n') : ''}`);
  switch (sub) {
    case 'list': {
      let list = t.tasks; if (values.status) list = list.filter((x) => x.status === values.status);
      if (values.json) { console.log(JSON.stringify(list, null, 2)); return; }
      const s = summary(t);
      console.log(`${s.total} tasks · ${s.done} done · ${s.in_progress} in progress · ${s.review} review · ${s.blocked} blocked · ${s.ready} ready`);
      for (const x of [...list].sort((a, b) => natural(a.id, b.id))) console.log(`${x.id.padEnd(6)} ${x.status.padEnd(12)} ${(x.priority || '').padEnd(8)} ${(x.epic || '').padEnd(5)} ${x.title}${x.blockedReason ? '  ⊘ ' + x.blockedReason : ''}`);
      return;
    }
    case 'batch': { const batch = executionBatch(cwd); console.log(JSON.stringify(batch, null, 2)); return; }
    case 'capture': case 'freshness': case 'policy': case 'verify': {
      const task = getTask(t, id);
      if (sub === 'verify' && values.template && values.out) { console.log(`verification template written to ${writeOut(cwd, values.out, verificationTemplate(task))}`); return; }
      const result = sub === 'capture' ? captureTask(cwd, task) : sub === 'freshness' ? taskFreshness(cwd, task) : sub === 'policy' ? verificationPolicy(task) : values.template ? verificationTemplate(task) : values.file ? recordVerification(cwd, task, readJson(path.resolve(cwd, values.file))) : null;
      if (!result) throw new Error('usage: task verify <id> --template [--out file] | --file report.json');
      console.log(JSON.stringify(result, null, 2)); return;
    }
    case 'ready': {
      const ready = readyTasks(t);
      if (values.json) console.log(JSON.stringify(ready, null, 2));
      else { console.log(`${ready.length} dependency-ready task(s). Check file ownership and shared contracts before parallel execution; this command does not launch workers.`); for (const task of ready) show(task); }
      return;
    }
    case 'next': {
      const n = nextTask(t);
      if (values.json) { console.log(JSON.stringify(n, null, 2)); if (!n) process.exitCode = 2; return; }
      if (!n) { const s = summary(t); console.log(s.total === s.done ? 'ALL_DONE: every task is done.' : s.blocked && s.in_progress + s.review + s.ready === 0 ? `ALL_BLOCKED: ${s.blocked} blocked task(s) need human input.` : 'NONE_READY: nothing ready (tasks in progress/review or waiting on dependencies).'); process.exitCode = 2; return; }
      show(n); return;
    }
    case 'show': show(getTask(t, id)); return;
    case 'context': { if (!id) throw new Error('task id required'); console.log(taskContext(cwd, id)); return; }
    case 'start': case 'review': case 'done': case 'complete': case 'block': case 'unblock': case 'reopen': {
      if (!id) throw new Error('task id required');
      const map = { start: 'in_progress', review: 'review', done: 'done', complete: 'done', block: 'blocked', unblock: 'todo', reopen: 'todo' };
      if (sub === 'block' && !values.reason) throw new Error('--reason "…" is required when blocking');
      if (sub === 'complete') {
        // review → record verification → done, in one command (one report file, no extra round trips)
        if (!values.file) throw new Error('usage: task complete <id> --file report.json [--agent a --model m --note "…"]');
        const report = readJson(path.resolve(cwd, values.file));
        if (!report) throw new Error(`cannot read ${values.file}`);
        const before = getTask(loadTasks(cwd), id);
        if (!['in_progress', 'review'].includes(before.status)) throw new Error(`${id} must be in progress or in review to complete (it is ${before.status})`);
        if (before.status === 'in_progress') transition(cwd, id, 'review', { agent: values.agent, model: values.model });
        recordVerification(cwd, getTask(loadTasks(cwd), id), report);
      }
      if (sub === 'start') for (const w of readinessWarnings(getTask(t, id), loadFeatures(cwd))) console.log(`definition of ready: ${w}`);
      if (sub === 'start' && loadState(cwd).options?.delegateTasks) { const tk = getTask(t, id); console.log(tk.risk === 'high' ? `delegated mode: ${id} is high risk, so implement and verify it in this session on the strongest model.` : `delegated mode: do not implement ${id} here. Give the pp-developer sub-agent the brief (product-planner task context ${id}), owned paths and acceptance; then the pp-qa sub-agent the brief, changed paths and the report template; review their evidence and run task complete.`); }
      const task = transition(cwd, id, map[sub], { note: values.note, reason: values.reason, agent: values.agent, model: values.model });
      console.log(`${task.id} → ${task.status}`);
      if ((task.qaReturns || 0) >= LOOP_LIMIT && task.status === 'in_progress') { console.log(`warning: QA has returned ${task.id} ${task.qaReturns} times. Possible loop: change approach, or block it with a precise reason and continue with other work.`); appendLog(cwd, { type: 'note', task: task.id, message: `possible loop: QA returned ${task.id} ${task.qaReturns} times` }); }
      const current = loadState(cwd);
      if (current.phase === 'done' && sub === 'reopen') { current.phase = 'build'; saveState(cwd, current); appendLog(cwd, { type: 'phase', from: 'done', to: 'build', message: 'Task reopened' }); }
      const out = refreshDashboard(cwd); if (out) console.log(`dashboard updated: ${path.relative(cwd, out)}`);
      const s = summary(loadTasks(cwd)); console.log(`progress: ${s.done}/${s.total} (${s.pct}%)`);
      if (map[sub] === 'done') { const done = epicCompleted(loadTasks(cwd), task); if (done) console.log(`epic ${done.id} complete: run its integration checks, then \`product-planner epic review ${done.id} --evidence "…"\``); }
      if (map[sub] === 'done' && s.done === s.total) { const st = loadState(cwd); if (st.phase === 'build' && !st.options?.requireVerification) { st.phase = 'done'; saveState(cwd, st); appendLog(cwd, { type: 'phase', to: 'done', message: 'All tasks complete' }); refreshDashboard(cwd); console.log('All tasks done – phase set to "done".'); } }
      if (map[sub] === 'done' && s.done === s.total && current.options?.requireVerification) console.log('All tasks done; run the final acceptance audit (audit template --out …, audit check --file …), then state phase done.');
      return;
    }
    case 'add': {
      const src = values.file ? readJson(path.resolve(cwd, values.file)) : JSON.parse(values.json || positionals[0] || '{}');
      if (src.tasks || src.epics) {
        const plan = mergeTaskPlan(cwd, src); saveTaskPlan(cwd, plan, src);
        console.log(`merged: now ${plan.merged.tasks.length} tasks in ${plan.merged.epics.length} epics`);
      } else { const task = addTask(cwd, src); console.log(`added ${task.id}: ${task.title}`); }
      refreshDashboard(cwd); return;
    }
    case 'update': {
      if (!id) throw new Error('task id required');
      const changes = JSON.parse(values.json || positionals[1] || '{}');
      const task = updateTask(cwd, id, changes, values.note);
      console.log(`${task.id} updated: ${Object.keys(changes).join(', ')}`); refreshDashboard(cwd); return;
    }
    case 'remove': {
      if (!id) throw new Error('task id required');
      const task = removeTask(cwd, id, values.reason);
      console.log(`${task.id} removed (${values.reason})`); refreshDashboard(cwd); return;
    }
    case 'validate': { const fx = loadFeatures(cwd); const errors = [...validateTasks(t), ...(fx.features.length ? [...validateFeatures(fx), ...coverage(fx, t).errors] : [])]; if (errors.length) { console.log(errors.join('\n')); process.exitCode = 1; } else console.log(`ok: ${t.tasks.length} tasks, ${t.epics.length} epics, ${readyTasks(t).length} ready`); return; }
    default: throw new Error(`unknown task subcommand "${sub}" (list, complete, batch, capture, freshness, policy, verify, ready, next, show, context, start, review, done, block, unblock, reopen, add, update, remove, validate)`);
  }
}

function cmdState(cwd, rest) {
  requireInit(cwd);
  const [sub, key, ...vals] = rest;
  const st = loadState(cwd);
  switch (sub) {
    case undefined: case 'get': { if (!key) { console.log(JSON.stringify(st, null, 2)); return; } const v = key.split('.').reduce((o, k) => o?.[k], st); console.log(typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v)); return; }
    case 'set': { if (!key || !vals.length) throw new Error('usage: state set <dotted.key> <value>'); setByPath(st, key, vals.join(' ')); saveState(cwd, st); console.log(`${key} = ${JSON.stringify(key.split('.').reduce((o, k) => o?.[k], st))}`); if (key.startsWith('models.')) { const n = syncClaudeAgents(cwd, st.models).length; if (n) console.log(`Claude Code agents updated with the planned models (${n} files)`); } refreshDashboard(cwd); return; }
    case 'phase': { if (!PHASES.includes(key)) throw new Error(`phase must be one of ${PHASES.join(', ')}`); if (key === 'build' && (st.planning.handoff !== 'done' || !loadTasks(cwd).tasks.length)) throw new Error('build requires an approved handoff and a nonempty task plan'); if (key === 'done' && st.options?.requireVerification && auditStatus(cwd).status !== 'pass') throw new Error('done requires a current passing acceptance audit'); const from = st.phase; if (from === key) { console.log(`phase is already ${key}`); return; } st.phase = key; saveState(cwd, st); appendLog(cwd, { type: 'phase', from, to: key }); console.log(`phase: ${from} → ${key}`); const out = refreshDashboard(cwd); if (key === 'build' && st.options?.autoOpenDashboard !== false && out) { openInBrowser(out); console.log(`opened ${path.relative(cwd, out)} in the browser`); } return; }
    case 'step': { const status = vals[0]; if (!PLANNING_STEPS.includes(key)) throw new Error(`step must be one of ${PLANNING_STEPS.join(', ')}`); if (!['pending', 'in_progress', 'done', 'skipped'].includes(status)) throw new Error('status must be pending|in_progress|done|skipped'); st.planning[key] = status; if (st.phase === 'init') st.phase = 'planning'; saveState(cwd, st); appendLog(cwd, { type: 'planning', step: key, to: status }); console.log(`planning.${key} = ${status}`); refreshDashboard(cwd); return; }
    case 'product': { const { values } = args([key, ...vals].filter(Boolean), { name: { type: 'string' }, tagline: { type: 'string' }, summary: { type: 'string' } }); Object.assign(st.product, Object.fromEntries(Object.entries(values).filter(([, v]) => v != null))); saveState(cwd, st); console.log(JSON.stringify(st.product, null, 2)); refreshDashboard(cwd); return; }
    default: throw new Error(`unknown state subcommand "${sub}"`);
  }
}

function cmdLog(cwd, rest) {
  requireInit(cwd);
  const { values, positionals } = args(rest, { agent: { type: 'string' }, model: { type: 'string' }, task: { type: 'string' } });
  const message = positionals.join(' ');
  if (!message) throw new Error('message required');
  appendLog(cwd, { type: 'note', message, agent: agentName(values.agent), model: values.model, task: values.task });
  refreshDashboard(cwd);
  console.log('logged');
}

async function cmdResearch(cwd, rest) {
  const [sub, ...more] = rest;
  const { values, positionals } = args(more, { max: { type: 'string' }, json: { type: 'boolean' }, 'max-chars': { type: 'string' } });
  switch (sub) {
    case 'search': {
      const q = positionals.join(' '); if (!q) throw new Error('query required');
      const results = await search(q, { max: Number(values.max || 8) });
      if (values.json) { console.log(JSON.stringify(results, null, 2)); return; }
      if (!results.length) { console.log('no results'); return; }
      results.forEach((r, i) => console.log(`${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}\n`)); return;
    }
    case 'fetch': {
      const url = positionals[0]; if (!url) throw new Error('url required');
      const page = await fetchPage(url, { maxChars: Number(values['max-chars'] || 12000) });
      if (values.json) { console.log(JSON.stringify(page, null, 2)); return; }
      console.log(`# ${page.title}\n${page.url}\n\n${page.text}${page.truncated ? '\n\n[truncated – use --max-chars to read more]' : ''}`); return;
    }
    case 'options': case 'setup': console.log(SETUP_OPTIONS); return;
    default: throw new Error('usage: research search "<query>" | fetch <url> | options');
  }
}

async function cmdMemory(cwd, rest) {
  requireInit(cwd);
  const [sub, ...more] = rest;
  const { values, positionals } = args(more, { paths: { type: 'string' }, k: { type: 'string' }, json: { type: 'boolean' } });
  switch (sub) {
    case 'index': { const r = await buildIndex(cwd, { paths: values.paths?.split(',') }); console.log(`indexed ${r.chunks} chunks from ${r.files} files (${r.backend})`); return; }
    case 'search': {
      const q = positionals.join(' '); if (!q) throw new Error('query required');
      const result = await searchMemory(cwd, q, Number(values.k || 5));
      const { backend, results } = result;
      if (result.warning) console.error(result.warning);
      if (values.json) { console.log(JSON.stringify(result, null, 2)); return; }
      console.log(`${results.length} result(s) via ${backend}\n`);
      for (const r of results) console.log(`--- ${r.file} (score ${r.score?.toFixed?.(3) ?? '-'})\n${r.text}\n`); return;
    }
    case 'setup': {
      console.log('Installing local vector search (LanceDB + transformers.js, ~150 MB incl. model on first use)…');
      const r = setupVector(cwd); console.log(`installed in ${r.dir}. Now run: product-planner memory index`); return;
    }
    case 'status': case undefined: console.log(JSON.stringify(memoryStatus(cwd), null, 2)); return;
    default: throw new Error('usage: memory index | search "<q>" | setup | status');
  }
}

function cmdBrowser(cwd, rest) {
  const [sub, ...more] = rest;
  const { values, positionals } = args(more, { tools: { type: 'string' }, engine: { type: 'string' }, headless: { type: 'boolean' }, version: { type: 'string' }, 'skip-install': { type: 'boolean' }, force: { type: 'boolean' }, detail: { type: 'string' }, json: { type: 'boolean' } });
  switch (sub) {
    case 'options': console.log(BROWSER_OPTIONS); return;
    case 'status': case undefined: {
      const s = browserStatus(cwd);
      if (values.json) { console.log(JSON.stringify(s, null, 2)); return; }
      console.log(`Recorded choice: ${s.choice ? `${s.choice.source}${s.choice.detail ? ` (${s.choice.detail})` : ''}${s.choice.package ? ` · ${s.choice.package} · ${s.choice.engine}` : ''}` : 'none yet (decided during pp-plan)'}`);
      console.log(`Browser MCP servers in project configs: ${s.servers.length ? s.servers.map((x) => `${x.name} (${x.tool}: ${x.file})`).join(', ') : 'none'}`);
      console.log(`Playwright browser cache: ${s.cachedBrowsers.length ? s.cachedBrowsers.join(', ') : 'empty'} (${s.playwrightCache})`);
      console.log(`Installed browsers: ${s.systemBrowsers.join(', ') || 'none detected'}`);
      console.log('Host built-in browsers cannot be detected from the shell; the agent checks its own tool list first.');
      return;
    }
    case 'use': {
      requireInit(cwd);
      const source = positionals[0];
      if (!['host', 'none'].includes(source)) throw new Error('usage: browser use host|none [--detail "…"] (use "browser setup" for Playwright MCP)');
      const b = recordChoice(cwd, { source, ...(values.detail ? { detail: values.detail } : {}) });
      console.log(`browser access recorded: ${b.source}${b.detail ? ` (${b.detail})` : ''}`); refreshDashboard(cwd); return;
    }
    case 'setup': {
      requireInit(cwd);
      const tools = values.tools?.split(',').map((x) => x.trim()).filter(Boolean);
      const unknown = (tools || []).filter((x) => !Object.hasOwn(TARGETS, x));
      if (unknown.length) throw new Error(`unknown tool(s): ${unknown.join(', ')} (known: ${Object.keys(TARGETS).join(', ')})`);
      const r = setupBrowser(cwd, { tools, engine: values.engine, headless: values.headless, version: values.version, skipInstall: values['skip-install'], force: values.force });
      console.log(`\nPlaywright MCP ${r.version}: ${r.cmd.join(' ')}`);
      for (const x of r.results) console.log(`  ${x.tool.padEnd(9)} ${x.action}${x.file ? ` ${x.file}` : ''}${x.detail ? `\n    ${x.detail.replace(/\n/g, '\n    ')}` : ''}`);
      console.log('\nReload or restart your AI tool session so it loads the new MCP server, and approve it if the tool asks.');
      refreshDashboard(cwd); return;
    }
    case 'remove': { requireInit(cwd); const removed = unregisterServer(cwd); console.log(removed.length ? `removed the ${'playwright'} server from: ${removed.join(', ')}` : 'no Playwright MCP entries found'); return; }
    default: throw new Error('usage: browser status | options | use host|none | setup | remove');
  }
}

function cmdFeature(cwd, rest) {
  requireInit(cwd);
  const [sub, id, field, ...vals] = rest;
  const f = loadFeatures(cwd);
  const show = (x) => console.log(`${x.id}  ${x.title}  [${x.priority} · ${x.status} · ${x.release}]${x.story ? `\n  ${x.story}` : ''}${x.flow?.length ? '\n  flow:\n' + x.flow.map((s, i) => `   ${i + 1}. ${s}`).join('\n') : ''}${x.acceptance.length ? '\n  acceptance:\n' + x.acceptance.map((a) => '   - ' + a).join('\n') : ''}${x.openQuestions.length ? '\n  open questions:\n' + x.openQuestions.map((q) => '   ? ' + q).join('\n') : ''}${x.assumptions.length ? '\n  assumptions:\n' + x.assumptions.map((a) => '   ~ ' + a).join('\n') : ''}`);
  switch (sub) {
    case 'list': case undefined: {
      if (rest.includes('--json')) { console.log(JSON.stringify(f.features, null, 2)); return; }
      if (!f.features.length) { console.log('no features yet (the pp-plan interview creates them)'); return; }
      const { byFeature } = coverage(f, loadTasks(cwd));
      for (const x of sortedFeatures(f)) { const ts = byFeature.get(x.id) || []; console.log(`${x.id.padEnd(4)} ${x.release.padEnd(6)} ${x.priority.padEnd(7)} ${x.status.padEnd(9)} ${x.title}${ts.length ? `  (${ts.filter((t) => t.status === 'done').length}/${ts.length} tasks done)` : ''}${x.openQuestions.length ? `  ?${x.openQuestions.length}` : ''}`); }
      return;
    }
    case 'show': { const x = f.features.find((y) => y.id === id); if (!x) throw new Error(`unknown feature ${id}`); show(x); return; }
    case 'add': {
      const { values, positionals } = args(rest.slice(1), { json: { type: 'string' }, file: { type: 'string' } });
      const src = values.file ? readJson(path.resolve(cwd, values.file)) : JSON.parse(values.json || positionals[0] || '{}');
      const r = upsertFeatures(cwd, Array.isArray(src.features) ? src.features : src.notFeatures ? [] : [src], { notFeatures: src.notFeatures });
      console.log(`features: ${r.added} added, ${r.updated} updated, ${r.total} total`); refreshDashboard(cwd); return;
    }
    case 'set': { if (!id || !field || !vals.length) throw new Error('usage: feature set <id> <field> <value>'); const x = setFeature(cwd, id, field, vals.join(' ')); console.log(`${x.id} ${field} = ${x[field]}`); refreshDashboard(cwd); return; }
    case 'check': {
      const structural = validateFeatures(f); const r = readiness(f);
      const errors = [...structural, ...r.errors];
      for (const w of r.warnings) console.log(`warning: ${w}`);
      if (errors.length) { console.log(errors.map((e) => `not ready: ${e}`).join('\n')); process.exitCode = 1; return; }
      console.log(`ready: ${r.mvp} accepted MVP feature(s) with acceptance criteria and no open questions`); return;
    }
    default: throw new Error('usage: feature list | show <id> | add --json/--file | set <id> <field> <value> | check');
  }
}

function cmdAuto(cwd, rest) {
  requireInit(cwd);
  const [sub] = rest;
  const config = loadConfig(cwd);
  if (sub === 'status' || sub === undefined) { console.log(`automatic mode: ${config.autoRun !== false ? 'on' : 'off'}`); return; }
  if (!['on', 'off'].includes(sub)) throw new Error('usage: auto on|off|status');
  config.autoRun = sub === 'on';
  writeJson(configPath(cwd), config);
  installTools(cwd, config.tools, undefined, { autoRun: config.autoRun, models: loadState(cwd).models || {} });
  console.log(`automatic mode ${sub}: ${config.autoRun ? 'agents start pp-plan, pp-replan and pp-resume from plain requests' : 'use the /pp-* commands (or say "run pp-plan")'}.\nInstructions refreshed for: ${config.tools.join(', ')}. Start a new chat session so the agent reloads them.`);
}

async function cmdUsage(cwd, rest) {
  const [sub] = rest;
  if (sub === 'hook') {
    // Called by the host's hooks; never fail the host's turn.
    try {
      if (isInitialised(cwd)) {
        let input = ''; for await (const c of process.stdin) input += c;
        // New usage changes the dashboard's token and cost figures: rebuild it now rather than at the next task command.
        const entries = runHook(cwd, input);
        if (entries?.length) { let root = cwd; try { root = JSON.parse(input).cwd || cwd; } catch { /* keep cwd */ } refreshDashboard(root); }
      }
    } catch (e) { if (process.env.PP_DEBUG) console.error(e); }
    return;
  }
  requireInit(cwd);
  if (sub === 'bind') { const { values } = args(rest.slice(1), { file: { type: 'string' }, task: { type: 'string' } }); console.log(JSON.stringify(bindUsage(cwd, values.file, values.task))); return; }
  const s = summarizeUsage(readUsage(cwd), { prices: loadConfig(cwd).pricing?.models });
  if (rest.includes('--json')) { console.log(JSON.stringify(s, null, 2)); return; }
  if (!s.all) { console.log('no usage recorded yet (Claude Code records it through the hook installed by init --tools claude)'); return; }
  const fmt = (t) => `${s.sum(t).toLocaleString()} tokens (output ${t.output.toLocaleString()}, cache read ${t.cacheRead.toLocaleString()})`;
  console.log(`Total: ${fmt(s.total)}`);
  if (s.cost.total || !s.cost.unpricedTokens) console.log(`Estimated cost: $${s.cost.total.toFixed(2)} at API list prices${s.cost.unpricedTokens ? ` (${s.cost.unpricedTokens.toLocaleString()} tokens from ${s.cost.unpricedModels.join(', ')} not priced)` : ''}`);
  for (const [k, v] of Object.entries(s.byPhase)) console.log(`  ${k.padEnd(10)} ${fmt(v)}`);
  for (const [k, v] of Object.entries(s.byTask).sort((a, b) => natural(a[0], b[0]))) console.log(`  ${k.padEnd(10)} ${fmt(v)}`);
  console.log(s.tracking.taskAllocation);
  for (const [k, v] of Object.entries(s.byStage)) console.log(`  stage ${k}: ${fmt(v)}`);
  for (const [k, v] of Object.entries(s.byAttribution)) console.log(`  attribution ${k}: ${fmt(v)}`);
  for (const [k, v] of Object.entries(s.byModel)) console.log(`  model ${k}: ${fmt(v)}`);
}
