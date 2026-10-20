/**
 * Quality profiles: the platform and regulatory checks a product must meet, chosen in planning,
 * turned into architecture decisions and tasks, run with every verification and audited at the end.
 * Each profile is a folder with a profile.json, like a skill: shipped in kit/profiles/<id>/, saved
 * to the user library (~/.product-planner/profiles/<id>/) for reuse across projects, or created for
 * one project in .product-planner/profiles/<id>/. Selected profiles are installed as skills for the
 * installed tools, so a model reads a profile's guidance only when it applies.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stateDir, appendLog, loadConfig } from './state.js';
import { readJson, writeJson, writeText, nowIso } from './util/fs.js';

const KIT_PROFILES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'kit', 'profiles');
const profilePath = (cwd) => path.join(stateDir(cwd), 'profile.json');
/** The user's profile library, shared by all their projects (PP_HOME overrides the location). */
export const userLibrary = () => path.join(process.env.PP_HOME || path.join(os.homedir(), '.product-planner'), 'profiles');
const projectProfiles = (cwd) => path.join(stateDir(cwd), 'profiles');
const readFolder = (dir, source) => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => {
    const p = readJson(path.join(dir, e.name, 'profile.json'));
    return p?.id ? { ...p, origin: source } : null;
  }).filter(Boolean);
};

/** Shipped profiles, then the user library, then the project's own (later ones override by id). */
export function loadCatalog(cwd) {
  const meta = readJson(path.join(KIT_PROFILES, 'questions.json'), { note: '', questions: [] });
  const byId = new Map();
  for (const p of [...readFolder(KIT_PROFILES, 'kit'), ...readFolder(userLibrary(), 'user library'), ...(cwd ? readFolder(projectProfiles(cwd), 'project') : [])]) byId.set(p.id, p);
  // Older projects may have entries in catalog.local.json.
  for (const p of (cwd ? readJson(path.join(stateDir(cwd), 'catalog.local.json'), { profiles: [] }) : { profiles: [] }).profiles || []) byId.set(p.id, { ...p, origin: 'project' });
  return { ...meta, profiles: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)) };
}

/** Validate a profile definition (used for new and saved profiles). */
export function validateProfileDef(p) {
  const errors = [];
  if (!/^[a-z0-9][a-z0-9-]*$/.test(p?.id || '')) errors.push('id must be lowercase letters, digits and dashes');
  for (const k of ['title', 'kind', 'appliesWhen']) if (!p?.[k]) errors.push(`${k} is required`);
  if (!['platform', 'regulation', 'baseline'].includes(p?.kind)) errors.push('kind must be platform, regulation or baseline');
  if (!Array.isArray(p?.sources) || !p.sources.length || p.sources.some((s) => !/^https?:\/\//.test(s?.url || ''))) errors.push('sources must list official pages with url');
  if (!Array.isArray(p?.gates) || !p.gates.length) errors.push('gates must not be empty');
  for (const g of p?.gates || []) {
    if (!/^G-[A-Z0-9-]+$/.test(g.id || '')) errors.push(`gate id ${g.id}: use G-UPPERCASE-WITH-DASHES`);
    if (!['automated', 'manual', 'legal'].includes(g.type)) errors.push(`${g.id}: type must be automated, manual or legal`);
    if (g.type === 'automated' && !g.command) errors.push(`${g.id}: automated gates need a command`);
    if (g.type !== 'legal' && !g.acceptance?.length) errors.push(`${g.id}: needs acceptance criteria`);
    if (!g.architecture && g.type !== 'legal') errors.push(`${g.id}: needs the architecture decision it requires`);
  }
  return errors;
}

/** Scaffold a project profile for a platform or regulation the catalog does not cover. */
export function newProfile(cwd, id, { title, kind }) {
  const dir = path.join(projectProfiles(cwd), id);
  if (fs.existsSync(path.join(dir, 'profile.json'))) throw new Error(`profile ${id} already exists in this project`);
  const draft = { id, kind: kind || 'platform', title: title || id, appliesWhen: '', ask: '', detect: { files: [], packages: [], requestWords: [] }, sources: [], lastVerified: null,
    gates: [{ id: 'G-' + id.toUpperCase().replace(/[^A-Z0-9]+/g, '-'), type: 'manual', title: '', architecture: '', acceptance: [] }], guidance: [] };
  writeJson(path.join(dir, 'profile.json'), draft);
  return { path: path.join(dir, 'profile.json'), draft };
}

/** Copy a project profile to the user library so future projects can use it. */
export function saveProfile(cwd, id) {
  const p = readJson(path.join(projectProfiles(cwd), id, 'profile.json'));
  if (!p) throw new Error(`no project profile ${id} (profile new ${id} creates one)`);
  const errors = validateProfileDef(p);
  if (errors.length) throw new Error(`profile ${id} is incomplete:\n${errors.join('\n')}`);
  const dest = path.join(userLibrary(), id, 'profile.json');
  writeJson(dest, { ...p, savedAt: nowIso() });
  return dest;
}

/** A profile rendered as a skill: when it applies, the gates with the decisions and checks they need, and sources. */
export function renderSkill(p, project) {
  const selected = project?.selected?.some((x) => x.id === p.id);
  const gates = selected ? project.gates.filter((g) => g.profiles?.includes(p.id)) : p.gates;
  const verified = project?.selected?.find((s) => s.id === p.id)?.verified;
  return `---
name: pp-profile-${p.id}
description: ${JSON.stringify(`${p.title} quality profile for this product: platform and regulatory gates, architecture decisions and checks. Use when designing, implementing, reviewing or verifying work that touches ${p.title}.`)}
---

# ${p.title}

Applies because: ${project?.selected?.find((s) => s.id === p.id)?.because || p.appliesWhen}
${verified ? `Verified against official sources on ${verified.at.slice(0, 10)}: ${verified.note}` : 'Not yet verified against its official sources for this project: check them before relying on details (product-planner profile verify).'}

## Gates

${gates.map((g) => `### ${g.id}: ${g.title} (${g.type === 'legal' ? 'needs legal review' : g.type})
${g.architecture ? `- Architecture decision: ${g.architecture}\n` : ''}${g.setup ? `- Setup: ${g.setup}\n` : ''}${g.command ? `- Check: \`${g.command}\` (run with \`product-planner profile run ${g.id}\`)\n` : ''}${g.acceptance?.length ? g.acceptance.map((a) => `- Acceptance: ${a}`).join('\n') + '\n' : ''}${g.type === 'legal' ? '- Never mark this as passed by a test; list it for review by a qualified person.\n' : ''}`).join('\n')}
${p.guidance?.length ? `## Guidance\n\n${p.guidance.map((x) => `- ${x}`).join('\n')}\n\n` : ''}## Sources

${(p.sources || []).map((s) => `- [${s.title || s.url}](${s.url})`).join('\n')}

Tasks that implement or check a gate list it in \`gates\`; each gate needs an architecture decision naming its id, and its evidence in the task's verification.
`;
}
/** Install the selected profiles as skills where the tools read skills; remove skills of deselected profiles. */
export function installProfileSkills(cwd) {
  const project = loadProfile(cwd);
  const catalog = loadCatalog(cwd);
  const tools = loadConfig(cwd).tools || [];
  const dirs = [...(tools.includes('claude') ? [path.join(cwd, '.claude', 'skills')] : []), ...(tools.some((t) => ['codex', 'generic', 'antigravity'].includes(t)) ? [path.join(cwd, '.agents', 'skills')] : [])];
  const wanted = new Set((project?.selected || []).map((s) => s.id));
  const written = [];
  for (const dir of dirs) {
    if (fs.existsSync(dir)) for (const e of fs.readdirSync(dir)) if (e.startsWith('pp-profile-') && !wanted.has(e.slice('pp-profile-'.length))) fs.rmSync(path.join(dir, e), { recursive: true, force: true });
    for (const id of wanted) { const p = catalog.profiles.find((x) => x.id === id); if (!p) continue; const f = path.join(dir, `pp-profile-${id}`, 'SKILL.md'); writeText(f, renderSkill(p, project)); written.push(f); }
  }
  return written;
}
export function loadProfile(cwd) { return readJson(profilePath(cwd), null); }

/** Repository signals that suggest a profile. Suggestions only: the interview confirms them. */
export function detectProfiles(cwd) {
  const pkg = readJson(path.join(cwd, 'package.json'), {}) || {};
  const composer = readJson(path.join(cwd, 'composer.json'), {}) || {};
  const deps = new Set([...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {}), ...Object.keys(composer.require || {}), ...Object.keys(composer['require-dev'] || {})]);
  const shallow = (ext) => {
    const top = fs.readdirSync(cwd, { withFileTypes: true }).filter((e) => !e.name.startsWith('.') && !['node_modules', 'vendor'].includes(e.name));
    return [...top.filter((e) => e.isFile() && e.name.endsWith(ext)).map((e) => ({ depth: 0, file: e.name })),
      ...top.filter((e) => e.isDirectory()).flatMap((d) => { try { return fs.readdirSync(path.join(cwd, d.name)).filter((f) => f.endsWith(ext)).map((f) => ({ depth: 1, file: `${d.name}/${f}` })); } catch { return []; } })];
  };
  const found = [];
  for (const p of loadCatalog(cwd).profiles) {
    const reasons = [];
    for (const f of p.detect?.files || []) if (fs.existsSync(path.join(cwd, f))) reasons.push(`${f} exists`);
    for (const d of p.detect?.packages || []) if (deps.has(d)) reasons.push(`depends on ${d}`);
    for (const c of p.detect?.contentPatterns || []) {
      const depth = c.glob.startsWith('*/') ? 1 : 0, ext = path.extname(c.glob);
      for (const { file } of shallow(ext).filter((x) => x.depth === depth)) {
        let head = ''; try { head = fs.readFileSync(path.join(cwd, file), 'utf8').slice(0, 8192); } catch { continue; }
        if (new RegExp(c.pattern, 'i').test(head)) { reasons.push(`${file} matches "${c.pattern}"`); break; }
      }
    }
    if (reasons.length) found.push({ id: p.id, title: p.title, kind: p.kind, reasons });
  }
  return found;
}

/** Select profiles (and the profiles they extend); gates are merged by id and keep earlier edits. */
export function setProfiles(cwd, ids, because) {
  if (!because?.trim()) throw new Error('--because "…" is required: the answers or repository evidence that make these profiles apply');
  const catalog = loadCatalog(cwd);
  const byId = new Map(catalog.profiles.map((p) => [p.id, p]));
  const wanted = [];
  const addWithParents = (id) => { const p = byId.get(id); if (!p) throw new Error(`unknown profile ${id} (see profile catalog)`); if (p.extends) addWithParents(p.extends); if (!wanted.includes(id)) wanted.push(id); };
  for (const id of ids) addWithParents(id);
  const current = loadProfile(cwd) || { selected: [], gates: [], removed: [], results: {} };
  for (const id of wanted) if (!current.selected.some((s) => s.id === id)) current.selected.push({ id, title: byId.get(id).title, kind: byId.get(id).kind, because: because.trim(), selectedAt: nowIso(), sources: byId.get(id).sources, verified: null });
  for (const s of current.selected) {
    for (const g of byId.get(s.id)?.gates || []) {
      if (current.removed.some((r) => r.id === g.id)) continue;
      const existing = current.gates.find((x) => x.id === g.id);
      if (existing) { if (!existing.profiles.includes(s.id)) existing.profiles.push(s.id); } else current.gates.push({ ...g, profiles: [s.id] });
    }
  }
  writeJson(profilePath(cwd), current);
  appendLog(cwd, { type: 'note', message: `quality profile: ${wanted.join(', ')} (${because.trim()})` });
  return current;
}

/** Record that a selected profile was checked against its official sources, and what was found. */
export function verifyProfile(cwd, id, { sources, note }) {
  const p = loadProfile(cwd);
  const s = p?.selected.find((x) => x.id === id);
  if (!s) throw new Error(`profile ${id} is not selected`);
  const urls = String(sources || '').split(',').map((u) => u.trim()).filter(Boolean);
  if (!urls.length || !note?.trim()) throw new Error('--sources "url,url" and --note "what was checked and any changes" are required');
  s.verified = { at: nowIso(), sources: urls, note: note.trim() };
  writeJson(profilePath(cwd), p);
  return s;
}

/** Adjust a gate for this project: its command, or remove it with a reason the user approved. */
export function editGate(cwd, id, { command, remove, reason }) {
  const p = loadProfile(cwd);
  const g = p?.gates.find((x) => x.id === id);
  if (!g) throw new Error(`unknown gate ${id}`);
  if (remove) {
    if (!reason?.trim()) throw new Error('--reason "…" is required to remove a gate');
    p.gates = p.gates.filter((x) => x.id !== id); p.removed.push({ id, title: g.title, reason: reason.trim(), at: nowIso() });
  } else if (command) { if (g.type !== 'automated') throw new Error(`${id} is ${g.type}; only automated gates have commands`); g.command = command; }
  else throw new Error('usage: profile gate <id> --command "…" | --remove --reason "…"');
  writeJson(profilePath(cwd), p);
  appendLog(cwd, { type: 'note', message: `gate ${id} ${remove ? `removed: ${reason}` : `command: ${command}`}` });
  return g;
}

/** Run automated gates in the project root and record the results. */
export function runGates(cwd, ids = []) {
  const p = loadProfile(cwd);
  if (!p) throw new Error('no quality profile selected (profile set …)');
  const gates = p.gates.filter((g) => g.type === 'automated' && (!ids.length || ids.includes(g.id)));
  const results = gates.map((g) => {
    const r = spawnSync(g.command, { cwd, shell: true, encoding: 'utf8', timeout: 10 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 });
    const output = `${r.stdout || ''}${r.stderr || ''}`.trim();
    return { id: g.id, command: g.command, pass: r.status === 0, exit: r.status, at: nowIso(), output: output.slice(-1500) };
  });
  for (const r of results) p.results[r.id] = r;
  writeJson(profilePath(cwd), p);
  return results;
}

/** Plan-check rules: every non-legal gate needs an architecture decision and a task; profiles need verification. */
/** Words in the request that point to a platform or regulated data, mapped to the profiles they suggest. */
const REQUEST_SIGNALS = [
  [/\bwoo ?commerce\b/i, 'woocommerce-extension'], [/\bword ?press\b|\bwp plugin\b/i, 'wordpress-plugin'], [/\bshopify\b/i, 'shopify-app'],
  [/\b(app store|play store|marketplace)\b/i, null], [/\bpersonal data|\bpii\b|\bgdpr\b|\bdpdp\b|\bccpa\b|\bprivacy\b|\bcustomer (data|records|details)\b/i, null],
  [/\b(card payments?|credit cards?|checkout payments?|pci)\b/i, 'pci-dss'], [/\b(health|medical|patient)\b/i, null], [/\bchildren|\bkids\b|\bunder 13\b/i, 'coppa'],
];
export function requestSignals(text, catalog = null) {
  const found = REQUEST_SIGNALS.filter(([re]) => re.test(text)).map(([re, id]) => ({ match: text.match(re)[0], profile: id }));
  // Profiles can name their own request words (for example a researched profile for "VS Code extension").
  for (const p of catalog?.profiles || []) for (const w of p.detect?.requestWords || []) {
    const m = text.match(new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'));
    if (m && !found.some((f) => f.profile === p.id)) found.push({ match: m[0], profile: p.id });
  }
  return found;
}
/** Record that no profile applies, with the reason the user agreed (so check stops asking). */
export function setNoProfile(cwd, because) {
  if (!because?.trim()) throw new Error('--because "…" is required: why no platform or regulatory profile applies');
  const current = loadProfile(cwd) || { selected: [], gates: [], removed: [], results: {} };
  current.none = { because: because.trim(), at: nowIso() };
  writeJson(profilePath(cwd), current);
  appendLog(cwd, { type: 'note', message: `quality profile: none applies (${because.trim()})` });
  return current;
}
export function profileCheck(cwd, { architecture, tasks, request = '' }) {
  const p = loadProfile(cwd);
  const errors = [], warnings = [];
  // The request mentions a platform or regulated data: a profile must be chosen, or "none applies" recorded.
  const signals = requestSignals(request, loadCatalog(cwd));
  if (signals.length && !p?.selected?.length && !p?.none) {
    const ids = [...new Set(signals.map((x) => x.profile).filter(Boolean))];
    errors.push(`the request mentions ${[...new Set(signals.map((x) => `"${x.match}"`))].join(', ')}: select a quality profile${ids.length ? ` (suggested: ${ids.join(', ')})` : ''} with profile set … --because "…", or record profile none --because "…"; on the direct path, switch to pp-plan`);
  }
  if (!p) return { errors, warnings };
  const taskText = (t) => [t.title, t.description, ...(t.acceptance || [])].join(' ');
  for (const g of p.gates) {
    if (g.type === 'legal') continue;
    if (!new RegExp(`\\b${g.id}\\b`).test(architecture)) errors.push(`${g.id} (${g.title}): no architecture decision; add one in the architecture's quality and compliance section that names ${g.id}`);
    if (!tasks.some((t) => t.gates?.includes(g.id) || new RegExp(`\\b${g.id}\\b`).test(taskText(t)))) errors.push(`${g.id} (${g.title}): no task delivers it; set "gates": ["${g.id}"] on the task that implements or checks it`);
  }
  for (const s of p.selected) if (!s.verified) warnings.push(`profile ${s.id}: not yet verified against its official sources (profile verify ${s.id} --sources … --note …)`);
  const legal = p.gates.filter((g) => g.type === 'legal');
  if (legal.length) warnings.push(`needs legal review (never marked passed by a test): ${legal.map((g) => g.id).join(', ')}`);
  return { errors, warnings };
}
