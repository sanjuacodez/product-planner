import path from 'node:path';
import fs from 'node:fs';
import { KIT_SRC, STATE_DIR, listFiles, readText, writeText, parseFrontmatter, upsertBlock, removeBlock, ensureDir } from '../util/fs.js';

export const MARKER = 'product-planner';
export const TOOLS = {
  claude: { label: 'Claude Code', detect: ['.claude', '~/.claude'], bins: ['claude'] },
  codex: { label: 'OpenAI Codex CLI', detect: ['.codex', '~/.codex'], bins: ['codex'] },
  gemini: { label: 'Gemini CLI', detect: ['.gemini', '~/.gemini'], bins: ['gemini'] },
  opencode: { label: 'OpenCode', detect: ['.opencode', '~/.config/opencode'], bins: ['opencode'] },
  cursor: { label: 'Cursor', detect: ['.cursor', '~/.cursor'], bins: ['cursor'] },
  windsurf: { label: 'Windsurf', detect: ['.windsurf', '~/.codeium'], bins: ['windsurf'] },
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

export function universalBlock(kit) {
  const wf = kit.workflows.map((w) => `| \`/${w.meta.name}\` | ${w.meta.description} |`).join('\n');
  const ag = kit.agents.map((a) => `- **${a.meta.name}** – ${a.meta.description}`).join('\n');
  return `## Product Planner

This project uses **product-planner**, a multi-agent product planning and build kit. The full operating manual is in \`${STATE_DIR}/kit/README.md\` – read it before doing any planning or build work. Project state (concept, research, PRD, UX, architecture, tasks, dashboard data) lives in \`${STATE_DIR}/\` and is committed to git.

### Workflows
When the user types one of these (as a slash command, or in plain words such as "run pp-plan" / "start planning" / "build the next task"), open the matching file in \`${STATE_DIR}/kit/workflows/\` and follow it step by step.

| Command | Purpose |
|---|---|
${wf}

### Agents
Specialist personas live in \`${STATE_DIR}/kit/agents/\`. If this tool supports sub-agents, delegate to them by name; otherwise adopt the persona file yourself for that step.

${ag}

### Ground rules
- All questions for the human are asked during planning (\`/pp-plan\`). The build phase (\`/pp-build\`) runs without stopping for input unless every remaining task is blocked.
- Track work only through \`product-planner task …\` commands (or by editing \`${STATE_DIR}/tasks.json\` when the CLI is unavailable). Never keep a parallel to-do list.
- After each task completes, the dashboard (\`product-dashboard.html\`) is regenerated automatically; the human watches that file, not the terminal.`;
}

const PREAMBLE = (w) => `${w.meta.description}\n\nThis is the \`${w.meta.name}\` workflow from product-planner. Read \`${STATE_DIR}/kit/README.md\` once for the operating manual; agent personas are in \`${STATE_DIR}/kit/agents/\`.\n\nUser input / arguments: $ARGUMENTS\n\n---\n\n`;
const toolsList = (a) => Array.isArray(a.meta.tools) ? a.meta.tools : (a.meta.tools ? String(a.meta.tools).split(',').map((s) => s.trim()) : []);

const ADAPTERS = {
  claude(cwd, kit) {
    const files = [];
    for (const a of kit.agents) {
      const p = path.join(cwd, '.claude', 'agents', `${a.meta.name}.md`);
      writeText(p, `---\nname: ${a.meta.name}\ndescription: ${a.meta.description}\n${toolsList(a).length ? `tools: ${toolsList(a).join(', ')}\n` : ''}${a.meta.model ? `model: ${a.meta.model}\n` : ''}---\n\n${a.body}\n`);
      files.push(p);
    }
    for (const w of kit.workflows) {
      const p = path.join(cwd, '.claude', 'commands', `${w.meta.name}.md`);
      writeText(p, `---\ndescription: ${w.meta.description}\n---\n\n${PREAMBLE(w)}${w.body}\n`);
      files.push(p);
    }
    upsertBlock(path.join(cwd, 'CLAUDE.md'), MARKER, universalBlock(kit) + `\n\nIn Claude Code the workflows are slash commands (\`/pp-plan\` …) and the agents are sub-agents in \`.claude/agents/\`; delegate with the host's available subagent tool.`);
    files.push(path.join(cwd, 'CLAUDE.md'));
    return files;
  },
  codex(cwd, kit) {
    const files = [];
    for (const w of kit.workflows) {
      const p = path.join(cwd, '.agents', 'skills', w.meta.name, 'SKILL.md');
      writeText(p, `---\nname: ${w.meta.name}\ndescription: ${w.meta.description}\n---\n\n${PREAMBLE(w).replace('$ARGUMENTS', '(the user\'s message)')}${w.body}\n`);
      files.push(p);
    }
    return files; // AGENTS.md block is written by the universal step
  },
  gemini(cwd, kit) {
    const files = [];
    for (const w of kit.workflows) {
      const short = w.meta.name.replace(/^pp-/, '');
      const p = path.join(cwd, '.gemini', 'commands', 'pp', `${short}.toml`);
      const prompt = (PREAMBLE(w).replace('$ARGUMENTS', '{{args}}') + w.body).replace(/"""/g, '"\\"\\"');
      writeText(p, `description = ${JSON.stringify(w.meta.description)}\nprompt = """\n${prompt}\n"""\n`);
      files.push(p);
    }
    upsertBlock(path.join(cwd, 'GEMINI.md'), MARKER, universalBlock(kit) + `\n\nIn Gemini CLI the workflows are custom commands: \`/pp:plan\`, \`/pp:build\`, \`/pp:status\`, \`/pp:ask\`, \`/pp:resume\`.`);
    files.push(path.join(cwd, 'GEMINI.md'));
    return files;
  },
  opencode(cwd, kit) {
    const files = [];
    for (const a of kit.agents) {
      const p = path.join(cwd, '.opencode', 'agents', `${a.meta.name}.md`);
      writeText(p, `---\ndescription: ${a.meta.description}\nmode: ${a.meta.name === 'pp-orchestrator' ? 'primary' : 'subagent'}\n---\n\n${a.body}\n`);
      files.push(p);
    }
    for (const w of kit.workflows) {
      const p = path.join(cwd, '.opencode', 'commands', `${w.meta.name}.md`);
      writeText(p, `---\ndescription: ${w.meta.description}\n---\n\n${PREAMBLE(w)}${w.body}\n`);
      files.push(p);
    }
    return files;
  },
  cursor(cwd, kit) {
    const files = [];
    const p = path.join(cwd, '.cursor', 'rules', 'product-planner.mdc');
    writeText(p, `---\ndescription: Product Planner multi-agent planning and build kit – how to run /pp-plan, /pp-build and friends\nalwaysApply: true\n---\n\n${universalBlock(kit)}\n`);
    files.push(p);
    for (const w of kit.workflows) {
      const c = path.join(cwd, '.cursor', 'commands', `${w.meta.name}.md`);
      writeText(c, `${PREAMBLE(w).replace('$ARGUMENTS', '(the user\'s message)')}${w.body}\n`);
      files.push(c);
    }
    return files;
  },
  windsurf(cwd, kit) {
    const files = [];
    const p = path.join(cwd, '.windsurf', 'rules', 'product-planner.md');
    writeText(p, `---\ntrigger: always_on\n---\n\n${universalBlock(kit)}\n`);
    files.push(p);
    for (const w of kit.workflows) {
      const c = path.join(cwd, '.windsurf', 'workflows', `${w.meta.name}.md`);
      writeText(c, `---\ndescription: ${w.meta.description}\n---\n\n${PREAMBLE(w).replace('$ARGUMENTS', '(the user\'s message)')}${w.body}\n`);
      files.push(c);
    }
    return files;
  },
  generic() { return []; },
};

export function installTools(cwd, tools, kit = loadKit()) {
  const written = [];
  installKit(cwd);
  upsertBlock(path.join(cwd, 'AGENTS.md'), MARKER, universalBlock(kit));
  written.push(path.join(cwd, 'AGENTS.md'));
  for (const t of tools) {
    if (!ADAPTERS[t]) throw new Error(`unknown tool "${t}" (known: ${Object.keys(TOOLS).join(', ')})`);
    written.push(...ADAPTERS[t](cwd, kit));
  }
  return written;
}

export function uninstallTools(cwd, kit = loadKit()) {
  const removed = [];
  const rm = (p) => { if (fs.existsSync(p)) { fs.rmSync(p, { recursive: true, force: true }); removed.push(p); } };
  for (const f of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']) { const p = path.join(cwd, f); if (fs.existsSync(p)) { removeBlock(p, MARKER); removed.push(p); } }
  for (const a of kit.agents) { rm(path.join(cwd, '.claude', 'agents', `${a.meta.name}.md`)); rm(path.join(cwd, '.opencode', 'agents', `${a.meta.name}.md`)); }
  for (const w of kit.workflows) {
    rm(path.join(cwd, '.claude', 'commands', `${w.meta.name}.md`));
    rm(path.join(cwd, '.agents', 'skills', w.meta.name));
    rm(path.join(cwd, '.opencode', 'commands', `${w.meta.name}.md`));
    rm(path.join(cwd, '.cursor', 'commands', `${w.meta.name}.md`));
    rm(path.join(cwd, '.windsurf', 'workflows', `${w.meta.name}.md`));
  }
  for (const w of kit.workflows) rm(path.join(cwd, '.gemini', 'commands', 'pp', `${w.meta.name.replace(/^pp-/, '')}.toml`));
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
