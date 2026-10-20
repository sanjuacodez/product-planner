/**
 * Quality profiles: the platform and regulatory checks a product must meet, chosen in planning,
 * turned into architecture decisions and tasks, run with every verification and audited at the end.
 * The catalog (kit/profiles/catalog.json) is a starting point; each selected entry is verified
 * against its official sources during planning and recorded in .product-planner/profile.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stateDir, appendLog } from './state.js';
import { readJson, writeJson, nowIso } from './util/fs.js';

const CATALOG = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'kit', 'profiles', 'catalog.json');
const profilePath = (cwd) => path.join(stateDir(cwd), 'profile.json');

/** The shipped catalog plus project-specific entries in .product-planner/catalog.local.json (same shape). */
export function loadCatalog(cwd) {
  const base = readJson(CATALOG);
  const local = cwd ? readJson(path.join(stateDir(cwd), 'catalog.local.json'), { profiles: [] }) : { profiles: [] };
  const byId = new Map(base.profiles.map((p) => [p.id, p]));
  for (const p of local.profiles || []) byId.set(p.id, p);
  return { ...base, profiles: [...byId.values()] };
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
export function profileCheck(cwd, { architecture, tasks }) {
  const p = loadProfile(cwd);
  const errors = [], warnings = [];
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
