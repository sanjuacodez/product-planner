import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { STATE_DIR, exists, writeJson, writeText, readText, readJson } from '../util/fs.js';
import { defaultState, defaultConfig, statePath, configPath, isInitialised, loadConfig } from '../state.js';
import { emptyTasks, tasksPath } from '../tasks.js';
import { TOOLS, detectTools, installTools } from './adapters.js';

export async function init(cwd, opts = {}) {
  const detected = detectTools(cwd);
  let tools = opts.tools;
  if (tools === 'all') tools = Object.keys(TOOLS);
  else if (typeof tools === 'string') tools = tools.split(',').map((s) => s.trim()).filter(Boolean);
  if (!tools) {
    const def = [...detected, 'generic'];
    if (opts.yes || !stdin.isTTY) tools = def;
    else tools = await promptTools(def);
  }
  if (!tools.includes('generic')) tools.push('generic');
  tools = [...new Set(tools)];

  const unknown = tools.filter((t) => !Object.hasOwn(TOOLS, t));
  if (unknown.length) throw new Error(`unknown tool(s): ${unknown.join(', ')}`);
  const fresh = !isInitialised(cwd);
  if (fresh) {
    writeJson(statePath(cwd), defaultState());
    writeJson(tasksPath(cwd), emptyTasks());
  }
  const config = fresh ? defaultConfig() : loadConfig(cwd);
  config.tools = tools;
  writeJson(configPath(cwd), config);
  const gi = path.join(cwd, STATE_DIR, '.gitignore');
  if (!exists(gi)) writeText(gi, '# keep everything in git except heavy local memory artefacts\nmemory/node_modules/\nmemory/lancedb/\nmemory/models/\n');
  for (const d of ['research', 'dashboard']) { const keep = path.join(cwd, STATE_DIR, d, '.gitkeep'); if (!exists(keep)) writeText(keep, ''); }
  const written = installTools(cwd, tools, undefined, { autoRun: config.autoRun !== false, models: readJson(statePath(cwd))?.models || {} });
  return { tools, detected, fresh, written };
}

async function promptTools(def) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    console.log('\nWhich AI coding tools should product-planner be installed for?');
    Object.entries(TOOLS).forEach(([k, t], i) => console.log(`  ${i + 1}. ${k.padEnd(9)} ${t.label}${def.includes(k) ? '  (detected)' : ''}`));
    const ans = (await rl.question(`\nEnter numbers or names, comma-separated, "all", or press Enter for [${def.join(', ')}]: `)).trim();
    if (!ans) return def;
    if (ans.toLowerCase() === 'all') return Object.keys(TOOLS);
    const keys = Object.keys(TOOLS);
    return ans.split(/[\s,]+/).map((x) => (/^\d+$/.test(x) ? keys[Number(x) - 1] : x)).filter((k) => keys.includes(k));
  } finally { rl.close(); }
}
