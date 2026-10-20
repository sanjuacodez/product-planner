import path from 'node:path';
import fs from 'node:fs';
import { KIT_SRC, STATE_DIR, listFiles, readText, writeText, readJson, writeJson, parseFrontmatter, upsertBlock, removeBlock, ensureDir } from '../util/fs.js';

export const HOOK_COMMAND = 'product-planner usage hook';
/** Claude Code hooks that record token usage per task (merged into .claude/settings.json). */
export function installClaudeHooks(cwd) {
  const file = path.join(cwd, '.claude', 'settings.json');
  const settings = readJson(file, {}) || {};
  settings.hooks ??= {};
  const ours = (e) => e.hooks?.some((h) => h.command === HOOK_COMMAND);
  for (const [event, matcher] of [['PostToolUse', 'Bash'], ['Stop', undefined]]) {
    settings.hooks[event] = (settings.hooks[event] || []).filter((e) => !ours(e));
    settings.hooks[event].push({ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command: HOOK_COMMAND }] });
  }
  writeJson(file, settings);
  return file;
}
export function removeClaudeHooks(cwd) {
  const file = path.join(cwd, '.claude', 'settings.json');
  const settings = readJson(file, null);
  if (!settings?.hooks) return false;
  for (const event of Object.keys(settings.hooks)) {
    settings.hooks[event] = settings.hooks[event].filter((e) => !e.hooks?.some((h) => h.command === HOOK_COMMAND));
    if (!settings.hooks[event].length) delete settings.hooks[event];
  }
  if (!Object.keys(settings.hooks).length) delete settings.hooks;
  writeJson(file, settings);
  return true;
}

export const MARKER = 'product-planner';
export const TOOLS = {
  claude: { label: 'Claude Code', detect: ['.claude', '~/.claude'], bins: ['claude'] },
  codex: { label: 'OpenAI Codex CLI', detect: ['.codex', '~/.codex'], bins: ['codex'] },
  gemini: { label: 'Gemini CLI (legacy; replaced by Antigravity CLI for consumers)', detect: ['.gemini', '~/.gemini'], bins: ['gemini'] },
  antigravity: { label: 'Google Antigravity (app, IDE and agy CLI)', detect: ['.agents/agents', '~/.gemini/config/agents'], bins: ['agy', 'antigravity'] },
  opencode: { label: 'OpenCode', detect: ['.opencode', '~/.config/opencode'], bins: ['opencode'] },
  cursor: { label: 'Cursor', detect: ['.cursor', '~/.cursor'], bins: ['cursor'] },
  windsurf: { label: 'Windsurf / Devin Desktop', detect: ['.windsurf', '~/.codeium'], bins: ['windsurf'] },
  generic: { label: 'Any other tool via AGENTS.md (Monocode, T3 Code, Cline, Roo, Kilo, Zed, Aider, …)', detect: [], bins: [] },
};

export function loadKit() {
  const read = (dir) => listFiles(path.join(KIT_SRC, dir), (f) => f.endsWith('.md')).sort().map((f) => {
    const { meta, body } = parseFrontmatter(readText(f));
    return { file: path.basename(f), slug: path.basename(f, '.md'), meta, body: body.trim() };
  });
  return { agents: read('agents'), workflows: read('workflows') };
}

/** Copy the canonical kit into .product-planner/kit so every tool can read it. */
export function installKit(cwd) {
  const dest = path.join(cwd, STATE_DIR, 'kit');
  for (const f of listFiles(KIT_SRC)) {
    const rel = path.relative(KIT_SRC, f);
    writeText(path.join(dest, rel), readText(f));
  }
  return dest;
}

/** Intent routing that lets the agent start workflows without slash commands (automatic mode). */
export function autoRunSection() {
  return `### Automatic mode (on)
Match each request to a workflow and announce it in one line ("Starting pp-plan; say stop to skip"):

| The user… | Run |
|---|---|
| asks to build something small and precisely specified (exact behaviour stated, about 5 tasks or fewer, no open product decisions) and authorizes building, and it is not for a platform or marketplace (WordPress, WooCommerce, Shopify, app stores) and handles no personal data, payments, health or children's data | \`pp-direct\` |
| describes a product, app or feature to build and no approved plan covers it | \`pp-plan\` |
| changes scope after approval: adds, changes, removes or defers a feature, or changes users, platform, stack, design or deadline | \`pp-replan\` |
| says build, continue, next task or keep going, or starts a new session on a planned project | \`pp-resume\` |
| asks for status, progress or the dashboard | \`pp-status\` |
| asks about the plan, decisions or code | \`pp-ask\` |

Small work that does not change the agreed scope (a bug fix, a typo, a code question): just do it and note it on the related task. If unsure whether a request changes scope, ask one short question. The user can turn this off with \`product-planner auto off\`.`;
}

/** The always-loaded instruction block. Kept short: every agent turn pays for it. Workflows carry the detail. */
export function universalBlock(kit, { autoRun = true } = {}) {
  const wf = kit.workflows.map((w) => `- \`${w.meta.name}\`: ${w.meta.description}`).join('\n');
  return `## Product Planner

This project uses **product-planner**: CLI \`product-planner\` (alias \`pp\`; if not found, use \`npx -y github:sanjuacodez/product-planner …\` with the same arguments). Planning state lives in \`${STATE_DIR}/\` and is committed to git. Each workflow is a file in \`${STATE_DIR}/kit/workflows/\` that lists the commands it needs: open the matching one and follow it step by step. \`${STATE_DIR}/kit/README.md\` is a reference manual: read only the section a step points to.

${autoRun ? autoRunSection() : `### Workflows
Run one when the user asks for it by name (\`/pp-plan\`) or in plain words ("start planning", "build the next task"):

${wf}`}

### Rules
- Questions for the human happen only in planning. The build runs without stopping unless every remaining task is blocked.
- Track work only with \`product-planner task …\` (edit \`${STATE_DIR}/tasks.json\` only if the CLI is unavailable); never keep a parallel to-do list.
- Every task: tests written with the code, the full test suite passing and verification recorded. The product is done only when the acceptance audit passes.
- Specialist personas are in \`${STATE_DIR}/kit/agents/\`: delegate to them when the host supports sub-agents, otherwise adopt the persona for that step. The dashboard (\`product-dashboard.html\`) updates itself.`;
}

const PREAMBLE = (w) => `${w.meta.description}\n\nThis is the \`${w.meta.name}\` workflow from product-planner. Each step names the commands it needs; \`${STATE_DIR}/kit/README.md\` is a reference manual, so read a section only when a step points to it. Agent personas are in \`${STATE_DIR}/kit/agents/\`.\n\nUser input / arguments: $ARGUMENTS\n\n---\n\n`;
const toolsList = (a) => Array.isArray(a.meta.tools) ? a.meta.tools : (a.meta.tools ? String(a.meta.tools).split(',').map((s) => s.trim()) : []);

/** The model a persona's sub-agent runs on: planned per role (state.models.<role>), then the persona default.
 * Claude Code honours `model:` in agent files (an alias such as sonnet or haiku, a full model id, or inherit). */
export function agentModel(a, models = {}) {
  const role = a.meta.name.replace(/^pp-/, '');
  return models[role] || a.meta.model || null;
}
/** The id a tool uses for a planned model: catalog ids map per tool (models/catalog.json "ids");
 * a model the tool cannot run maps to null, so its agent inherits the session model. */
let catalogCache = null;
function modelCatalog() {
  if (!catalogCache) { try { catalogCache = JSON.parse(fs.readFileSync(path.join(KIT_SRC, 'models', 'catalog.json'), 'utf8')); } catch { catalogCache = { models: [] }; } }
  return catalogCache;
}
export function hostModel(value, host) {
  if (!value || value === 'inherit') return null;
  const m = modelCatalog().models.find((x) => x.id === value || Object.values(x.ids || {}).includes(value));
  if (m) return m.ids?.[host] ?? null;
  return value; // not in the catalog: the user's own id for this tool, written as given
}
const agentModelFor = (a, models, host) => hostModel(agentModel(a, models), host);

/** Per-tool agent files with each role's model, where the tool reads a model from project files. */
const AGENT_WRITERS = {
  claude: (cwd, a, models) => {
    const p = path.join(cwd, '.claude', 'agents', `${a.meta.name}.md`);
    const model = agentModelFor(a, models, 'claude-code');
    writeText(p, `---\nname: ${a.meta.name}\ndescription: ${a.meta.description}\n${toolsList(a).length ? `tools: ${toolsList(a).join(', ')}\n` : ''}${model ? `model: ${model}\n` : ''}---\n\n${a.body}\n`);
    return p;
  },
  codex: (cwd, a, models) => {
    const p = path.join(cwd, '.codex', 'agents', `${a.meta.name}.toml`);
    const model = agentModelFor(a, models, 'codex');
    const body = a.body.includes("'''") ? `"""\n${a.body.replace(/\\/g, '\\\\').replace(/"""/g, '\\"\\"\\"')}\n"""` : `'''\n${a.body}\n'''`;
    writeText(p, `name = ${JSON.stringify(a.meta.name)}\ndescription = ${JSON.stringify(a.meta.description)}\n${model ? `model = ${JSON.stringify(model)}\n` : ''}developer_instructions = ${body}\n`);
    return p;
  },
  opencode: (cwd, a, models) => {
    const p = path.join(cwd, '.opencode', 'agents', `${a.meta.name}.md`);
    const model = agentModelFor(a, models, 'opencode');
    writeText(p, `---\ndescription: ${a.meta.description}\nmode: ${a.meta.name === 'pp-orchestrator' ? 'primary' : 'subagent'}\n${model ? `model: ${model}\n` : ''}---\n\n${a.body}\n`);
    return p;
  },
  cursor: (cwd, a, models) => {
    // Cursor also reads .claude/agents; its own folder wins on a name clash, so Claude aliases never reach Cursor.
    const p = path.join(cwd, '.cursor', 'agents', `${a.meta.name}.md`);
    writeText(p, `---\nname: ${a.meta.name}\ndescription: ${a.meta.description}\nmodel: ${agentModelFor(a, models, 'cursor') || 'inherit'}\n---\n\n${a.body}\n`);
    return p;
  },
  antigravity: (cwd, a, models) => {
    // Antigravity agent files accept only inherit, flash or pro (Gemini tiers); other models are chosen in its UI.
    const p = path.join(cwd, '.agents', 'agents', `${a.meta.name}.md`);
    writeText(p, `---\nname: ${a.meta.name}\ndescription: ${JSON.stringify(a.meta.description)}\nsubagent: true\nmainAgent: false\nmodel: ${agentModelFor(a, models, 'antigravity') || 'inherit'}\n---\n\n${a.body}\n`);
    return p;
  },
  gemini: (cwd, a, models) => {
    const p = path.join(cwd, '.gemini', 'agents', `${a.meta.name}.md`);
    writeText(p, `---\nname: ${a.meta.name}\ndescription: ${JSON.stringify(a.meta.description)}\nmodel: ${agentModelFor(a, models, 'gemini') || 'inherit'}\n---\n\n${a.body}\n`);
    return p;
  },
};
/** Rewrite agent files for every installed tool after the planned models change. Returns files per tool. */
export function syncAgentModels(cwd, models, kit = loadKit(), tools = null) {
  const installed = tools || (() => { try { return JSON.parse(fs.readFileSync(path.join(cwd, STATE_DIR, 'config.json'), 'utf8')).tools || []; } catch { return []; } })();
  const out = {};
  for (const t of installed) if (AGENT_WRITERS[t]) out[t] = kit.agents.map((a) => AGENT_WRITERS[t](cwd, a, models));
  return out;
}
/** Back-compatible: Claude Code agent files only (when installed). */
export function syncClaudeAgents(cwd, models, kit = loadKit()) {
  if (!fs.existsSync(path.join(cwd, '.claude', 'agents'))) return [];
  return kit.agents.map((a) => AGENT_WRITERS.claude(cwd, a, models));
}

const ADAPTERS = {
  claude(cwd, kit, opts = {}) {
    const files = [];
    for (const a of kit.agents) files.push(AGENT_WRITERS.claude(cwd, a, opts.models));
    for (const w of kit.workflows) {
      const p = path.join(cwd, '.claude', 'commands', `${w.meta.name}.md`);
      writeText(p, `---\ndescription: ${w.meta.description}\n---\n\n${PREAMBLE(w)}${w.body}\n`);
      files.push(p);
    }
    upsertBlock(path.join(cwd, 'CLAUDE.md'), MARKER, universalBlock(kit, opts) + `\n\nIn Claude Code the workflows are slash commands (\`/pp-plan\` …) and the agents are sub-agents in \`.claude/agents/\`; delegate with the host's available subagent tool.`);
    files.push(path.join(cwd, 'CLAUDE.md'));
    files.push(installClaudeHooks(cwd));
    return files;
  },
  codex(cwd, kit, opts = {}) {
    const files = kit.agents.map((a) => AGENT_WRITERS.codex(cwd, a, opts.models));
    for (const w of kit.workflows) {
      const p = path.join(cwd, '.agents', 'skills', w.meta.name, 'SKILL.md');
      writeText(p, `---\nname: ${w.meta.name}\ndescription: ${w.meta.description}\n---\n\n${PREAMBLE(w).replace('$ARGUMENTS', '(the user\'s message)')}${w.body}\n`);
      files.push(p);
    }
    return files; // AGENTS.md block is written by the universal step
  },
  gemini(cwd, kit, opts = {}) {
    const files = kit.agents.map((a) => AGENT_WRITERS.gemini(cwd, a, opts.models));
    for (const w of kit.workflows) {
      const short = w.meta.name.replace(/^pp-/, '');
      const p = path.join(cwd, '.gemini', 'commands', 'pp', `${short}.toml`);
      const prompt = (PREAMBLE(w).replace('$ARGUMENTS', '{{args}}') + w.body).replace(/"""/g, '"\\"\\"');
      writeText(p, `description = ${JSON.stringify(w.meta.description)}\nprompt = """\n${prompt}\n"""\n`);
      files.push(p);
    }
    upsertBlock(path.join(cwd, 'GEMINI.md'), MARKER, universalBlock(kit, opts) + `\n\nIn Gemini CLI the workflows are custom commands: ${kit.workflows.map((w) => `\`/pp:${w.meta.name.replace(/^pp-/, '')}\``).join(', ')}.`);
    files.push(path.join(cwd, 'GEMINI.md'));
    return files;
  },
  opencode(cwd, kit, opts = {}) {
    const files = [];
    for (const a of kit.agents) files.push(AGENT_WRITERS.opencode(cwd, a, opts.models));
    for (const w of kit.workflows) {
      const p = path.join(cwd, '.opencode', 'commands', `${w.meta.name}.md`);
      writeText(p, `---\ndescription: ${w.meta.description}\n---\n\n${PREAMBLE(w)}${w.body}\n`);
      files.push(p);
    }
    return files;
  },
  cursor(cwd, kit, opts = {}) {
    const files = kit.agents.map((a) => AGENT_WRITERS.cursor(cwd, a, opts.models));
    const p = path.join(cwd, '.cursor', 'rules', 'product-planner.mdc');
    writeText(p, `---\ndescription: Product Planner multi-agent planning and build kit – how to run /pp-plan, /pp-build and friends\nalwaysApply: true\n---\n\n${universalBlock(kit, opts)}\n`);
    files.push(p);
    for (const w of kit.workflows) {
      const c = path.join(cwd, '.cursor', 'commands', `${w.meta.name}.md`);
      writeText(c, `${PREAMBLE(w).replace('$ARGUMENTS', '(the user\'s message)')}${w.body}\n`);
      files.push(c);
    }
    return files;
  },
  windsurf(cwd, kit, opts = {}) {
    const files = [];
    const p = path.join(cwd, '.windsurf', 'rules', 'product-planner.md');
    writeText(p, `---\ntrigger: always_on\n---\n\n${universalBlock(kit, opts)}\n`);
    files.push(p);
    for (const w of kit.workflows) {
      const c = path.join(cwd, '.windsurf', 'workflows', `${w.meta.name}.md`);
      writeText(c, `---\ndescription: ${w.meta.description}\n---\n\n${PREAMBLE(w).replace('$ARGUMENTS', '(the user\'s message)')}${w.body}\n`);
      files.push(c);
    }
    return files;
  },
  antigravity(cwd, kit, opts = {}) { return kit.agents.map((a) => AGENT_WRITERS.antigravity(cwd, a, opts.models)); },
  generic() { return []; },
};

export function installTools(cwd, tools, kit = loadKit(), opts = {}) {
  const written = [];
  installKit(cwd);
  upsertBlock(path.join(cwd, 'AGENTS.md'), MARKER, universalBlock(kit, opts));
  written.push(path.join(cwd, 'AGENTS.md'));
  for (const t of tools) {
    if (!ADAPTERS[t]) throw new Error(`unknown tool "${t}" (known: ${Object.keys(TOOLS).join(', ')})`);
    written.push(...ADAPTERS[t](cwd, kit, opts));
  }
  return written;
}

export function uninstallTools(cwd, kit = loadKit()) {
  const removed = [];
  const rm = (p) => { if (fs.existsSync(p)) { fs.rmSync(p, { recursive: true, force: true }); removed.push(p); } };
  for (const f of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']) { const p = path.join(cwd, f); if (fs.existsSync(p)) { removeBlock(p, MARKER); removed.push(p); } }
  for (const dir of [path.join(cwd, '.claude', 'skills'), path.join(cwd, '.agents', 'skills')]) if (fs.existsSync(dir)) for (const e of fs.readdirSync(dir)) if (e.startsWith('pp-profile-')) fs.rmSync(path.join(dir, e), { recursive: true, force: true });
  for (const a of kit.agents) for (const f of [['.claude', 'agents', `${a.meta.name}.md`], ['.opencode', 'agents', `${a.meta.name}.md`], ['.codex', 'agents', `${a.meta.name}.toml`], ['.cursor', 'agents', `${a.meta.name}.md`], ['.agents', 'agents', `${a.meta.name}.md`], ['.gemini', 'agents', `${a.meta.name}.md`]]) rm(path.join(cwd, ...f));
  for (const w of kit.workflows) {
    rm(path.join(cwd, '.claude', 'commands', `${w.meta.name}.md`));
    rm(path.join(cwd, '.agents', 'skills', w.meta.name));
    rm(path.join(cwd, '.opencode', 'commands', `${w.meta.name}.md`));
    rm(path.join(cwd, '.cursor', 'commands', `${w.meta.name}.md`));
    rm(path.join(cwd, '.windsurf', 'workflows', `${w.meta.name}.md`));
  }
  for (const w of kit.workflows) rm(path.join(cwd, '.gemini', 'commands', 'pp', `${w.meta.name.replace(/^pp-/, '')}.toml`));
  if (removeClaudeHooks(cwd)) removed.push(path.join(cwd, '.claude', 'settings.json'));
  rm(path.join(cwd, '.cursor', 'rules', 'product-planner.mdc'));
  rm(path.join(cwd, '.windsurf', 'rules', 'product-planner.md'));
  return removed;
}

export function detectTools(cwd) {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const found = [];
  const onPath = (bin) => (process.env.PATH || '').split(path.delimiter).some((d) => d && fs.existsSync(path.join(d, bin)));
  for (const [key, t] of Object.entries(TOOLS)) {
    if (key === 'generic') continue;
    const hit = t.detect.some((d) => fs.existsSync(d.startsWith('~') ? path.join(home, d.slice(2)) : path.join(cwd, d))) || t.bins.some(onPath);
    if (hit) found.push(key);
  }
  return found;
}
