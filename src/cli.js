import path from 'node:path';
import { parseArgs } from 'node:util';
import { PKG_ROOT, STATE_DIR, readJson, nowIso } from './util/fs.js';
import { init } from './init/index.js';
import { TOOLS, uninstallTools } from './init/adapters.js';
import { loadState, saveState, loadConfig, setByPath, appendLog, PHASES, PLANNING_STEPS, isInitialised, configPath } from './state.js';
import { loadTasks, saveTasks, validateTasks, summary, nextTask, readyTasks, transition, addTask, getTask, STATUSES, natural, normalise as saveNormalised } from './tasks.js';
import { buildDashboard, openInBrowser, watchDashboard } from './dashboard/index.js';
import { search, fetchPage, SETUP_OPTIONS } from './research/index.js';
import { buildIndex, searchMemory, setupVector, memoryStatus } from './memory/index.js';
import { doctor } from './doctor.js';
import { writeJson } from './util/fs.js';

const HELP = `product-planner – multi-agent product planning & build kit

Usage: product-planner <command> [options]

  init [--tools a,b|all] [--yes]      Install agents/workflows for your AI tools and create ${STATE_DIR}/
  uninstall                           Remove installed tool files (keeps ${STATE_DIR}/ project data)
  status [--json]                     Phase, planning progress and task summary
  dashboard [--open] [--watch] [--no-refresh]   Generate product-dashboard.html (optionally open / keep rebuilding)
  task list [--status s] [--json]     List tasks
  task next [--json]                  Next ready task (deps satisfied, by priority)
  task show <id>                      Show one task
  task start|review|done|block|unblock|reopen <id> [--note "…"] [--reason "…"] [--agent name]
  task add --json '{…}' | --file f    Add one task (or {"epics":[],"tasks":[]} file to merge)
  task validate                       Check tasks.json for errors
  state get [key] | set <key> <value> | phase <phase> | step <step> <status> | product --name --tagline --summary
  log "<message>" [--agent a] [--task id]   Append to the activity log
  research search "<query>" [--max n] [--json]   Key-less web search (DuckDuckGo)
  research fetch <url> [--max-chars n] [--json]  Fetch a page as readable text
  research options                    Print free research setup options
  memory index [--paths p1,p2] | search "<q>" [--k n] | setup | status   Project memory (BM25, optional local vectors)
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
    case 'state': return cmdState(cwd, rest);
    case 'log': return cmdLog(cwd, rest);
    case 'research': return cmdResearch(cwd, rest);
    case 'memory': return cmdMemory(cwd, rest);
    case 'doctor': { const checks = await doctor(cwd); for (const c of checks) console.log(`${c.ok ? '✔' : '✖'} ${c.name.padEnd(12)} ${c.detail}`); if (checks.some((c) => !c.ok)) process.exitCode = 1; return; }
    default: throw new Error(`unknown command "${cmd}". Run product-planner help`);
  }
}

function args(rest, options, allowPositionals = true) {
  return parseArgs({ args: rest, options, allowPositionals, strict: true });
}
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

function cmdTask(cwd, rest) {
  requireInit(cwd);
  const [sub, id] = rest;
  const { values, positionals } = args(rest.slice(1), { status: { type: 'string' }, json: { type: sub === 'add' ? 'string' : 'boolean' }, note: { type: 'string' }, reason: { type: 'string' }, agent: { type: 'string' }, file: { type: 'string' } });
  const t = loadTasks(cwd);
  const show = (task) => console.log(`${task.id}  [${task.status}] ${task.title}\n  epic: ${task.epic || '-'} · agent: ${task.agent} · priority: ${task.priority}${task.estimate ? ' · estimate: ' + task.estimate : ''}${task.dependsOn.length ? '\n  depends on: ' + task.dependsOn.join(', ') : ''}${task.description ? '\n  ' + task.description.replace(/\n/g, '\n  ') : ''}${task.acceptance.length ? '\n  acceptance:\n' + task.acceptance.map((a) => '   - ' + a).join('\n') : ''}${task.blockedReason ? '\n  BLOCKED: ' + task.blockedReason : ''}${task.notes.length ? '\n  notes:\n' + task.notes.map((n) => `   - ${n.ts.slice(0, 16)} ${n.agent ? n.agent + ': ' : ''}${n.text}`).join('\n') : ''}`);
  switch (sub) {
    case 'list': {
      let list = t.tasks; if (values.status) list = list.filter((x) => x.status === values.status);
      if (values.json) { console.log(JSON.stringify(list, null, 2)); return; }
      const s = summary(t);
      console.log(`${s.total} tasks · ${s.done} done · ${s.in_progress} in progress · ${s.review} review · ${s.blocked} blocked · ${s.ready} ready`);
      for (const x of [...list].sort((a, b) => natural(a.id, b.id))) console.log(`${x.id.padEnd(6)} ${x.status.padEnd(12)} ${(x.priority || '').padEnd(8)} ${(x.epic || '').padEnd(5)} ${x.title}${x.blockedReason ? '  ⊘ ' + x.blockedReason : ''}`);
      return;
    }
    case 'next': {
      const n = nextTask(t);
      if (values.json) { console.log(JSON.stringify(n, null, 2)); if (!n) process.exitCode = 2; return; }
      if (!n) { const s = summary(t); console.log(s.total === s.done ? 'ALL_DONE: every task is done.' : s.blocked && s.in_progress + s.review + s.ready === 0 ? `ALL_BLOCKED: ${s.blocked} blocked task(s) need human input.` : 'NONE_READY: nothing ready (tasks in progress/review or waiting on dependencies).'); process.exitCode = 2; return; }
      show(n); return;
    }
    case 'show': show(getTask(t, id)); return;
    case 'start': case 'review': case 'done': case 'block': case 'unblock': case 'reopen': {
      if (!id) throw new Error('task id required');
      const map = { start: 'in_progress', review: 'review', done: 'done', block: 'blocked', unblock: 'todo', reopen: 'todo' };
      if (sub === 'block' && !values.reason) throw new Error('--reason "…" is required when blocking');
      const task = transition(cwd, id, map[sub], { note: values.note, reason: values.reason, agent: values.agent });
      console.log(`${task.id} → ${task.status}`);
      const current = loadState(cwd);
      if (current.phase === 'done' && sub === 'reopen') { current.phase = 'build'; saveState(cwd, current); appendLog(cwd, { type: 'phase', from: 'done', to: 'build', message: 'Task reopened' }); }
      const out = refreshDashboard(cwd); if (out) console.log(`dashboard updated: ${path.relative(cwd, out)}`);
      const s = summary(loadTasks(cwd)); console.log(`progress: ${s.done}/${s.total} (${s.pct}%)`);
      if (sub === 'done' && s.done === s.total) { const st = loadState(cwd); if (st.phase === 'build') { st.phase = 'done'; saveState(cwd, st); appendLog(cwd, { type: 'phase', to: 'done', message: 'All tasks complete' }); refreshDashboard(cwd); console.log('All tasks done – phase set to "done".'); } }
      return;
    }
    case 'add': {
      const src = values.file ? readJson(path.resolve(cwd, values.file)) : JSON.parse(values.json || positionals[0] || '{}');
      if (src.tasks || src.epics) {
        const merged = loadTasks(cwd);
        for (const e of src.epics || []) if (!merged.epics.some((x) => x.id === e.id)) merged.epics.push(e);
        const imported = [];
        for (const task of src.tasks || []) if (!merged.tasks.some((x) => x.id === task.id)) { merged.tasks.push(task); imported.push(task); }
        saveNormalised(merged); const errors = validateTasks(merged); if (errors.length) throw new Error(errors.join('\n'));
        saveTasks(cwd, merged);
        for (const task of imported) appendLog(cwd, { type: 'task', task: task.id, from: null, to: task.status, note: `imported: ${task.title}` });
        appendLog(cwd, { type: 'plan', message: `imported ${(src.tasks || []).length} tasks, ${(src.epics || []).length} epics` });
        console.log(`merged: now ${merged.tasks.length} tasks in ${merged.epics.length} epics`);
      } else { const task = addTask(cwd, src); console.log(`added ${task.id}: ${task.title}`); }
      refreshDashboard(cwd); return;
    }
    case 'validate': { const errors = validateTasks(t); if (errors.length) { console.log(errors.join('\n')); process.exitCode = 1; } else console.log(`ok: ${t.tasks.length} tasks, ${t.epics.length} epics, ${readyTasks(t).length} ready`); return; }
    default: throw new Error(`unknown task subcommand "${sub}" (list, next, show, start, review, done, block, unblock, reopen, add, validate)`);
  }
}

function cmdState(cwd, rest) {
  requireInit(cwd);
  const [sub, key, ...vals] = rest;
  const st = loadState(cwd);
  switch (sub) {
    case undefined: case 'get': { if (!key) { console.log(JSON.stringify(st, null, 2)); return; } const v = key.split('.').reduce((o, k) => o?.[k], st); console.log(typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v)); return; }
    case 'set': { if (!key || !vals.length) throw new Error('usage: state set <dotted.key> <value>'); setByPath(st, key, vals.join(' ')); saveState(cwd, st); console.log(`${key} = ${JSON.stringify(key.split('.').reduce((o, k) => o?.[k], st))}`); refreshDashboard(cwd); return; }
    case 'phase': { if (!PHASES.includes(key)) throw new Error(`phase must be one of ${PHASES.join(', ')}`); if (key === 'build' && (st.planning.handoff !== 'done' || !loadTasks(cwd).tasks.length)) throw new Error('build requires an approved handoff and a nonempty task plan'); const from = st.phase; st.phase = key; saveState(cwd, st); appendLog(cwd, { type: 'phase', from, to: key }); console.log(`phase: ${from} → ${key}`); const out = refreshDashboard(cwd); if (key === 'build' && st.options?.autoOpenDashboard !== false && out) { openInBrowser(out); console.log(`opened ${path.relative(cwd, out)} in the browser`); } return; }
    case 'step': { const status = vals[0]; if (!PLANNING_STEPS.includes(key)) throw new Error(`step must be one of ${PLANNING_STEPS.join(', ')}`); if (!['pending', 'in_progress', 'done', 'skipped'].includes(status)) throw new Error('status must be pending|in_progress|done|skipped'); st.planning[key] = status; if (st.phase === 'init') st.phase = 'planning'; saveState(cwd, st); appendLog(cwd, { type: 'planning', step: key, to: status }); console.log(`planning.${key} = ${status}`); refreshDashboard(cwd); return; }
    case 'product': { const { values } = args([key, ...vals].filter(Boolean), { name: { type: 'string' }, tagline: { type: 'string' }, summary: { type: 'string' } }); Object.assign(st.product, Object.fromEntries(Object.entries(values).filter(([, v]) => v != null))); saveState(cwd, st); console.log(JSON.stringify(st.product, null, 2)); refreshDashboard(cwd); return; }
    default: throw new Error(`unknown state subcommand "${sub}"`);
  }
}

function cmdLog(cwd, rest) {
  requireInit(cwd);
  const { values, positionals } = args(rest, { agent: { type: 'string' }, task: { type: 'string' } });
  const message = positionals.join(' ');
  if (!message) throw new Error('message required');
  appendLog(cwd, { type: 'note', message, agent: values.agent, task: values.task });
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
      const { backend, results } = await searchMemory(cwd, q, Number(values.k || 5));
      if (values.json) { console.log(JSON.stringify(results, null, 2)); return; }
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
