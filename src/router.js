/**
 * Model router: recommends the model for each task from what the project can actually use,
 * explains why, spreads equally suitable work across providers, routes independent review to a
 * different provider, and learns from the project's own outcomes. Recommendations are written as
 * the task's requested model; the actual model is still recorded on every transition.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadState, saveState, loadConfig, stateDir, appendLog } from './state.js';
import { loadTasks, saveTasks } from './tasks.js';
import { readJson, writeJson } from './util/fs.js';
import { readUsage, summarizeUsage } from './usage.js';
import { baseModelId } from './pricing.js';

const CATALOG = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'kit', 'models', 'catalog.json');
export const TIERS = ['fast', 'strong', 'frontier'];
const rank = (t) => TIERS.indexOf(t);
const localPath = (cwd) => path.join(stateDir(cwd), 'models.local.json');

/** The shipped catalog plus project entries in .product-planner/models.local.json (same shape; same id overrides). */
export function loadModelCatalog(cwd) {
  const base = readJson(CATALOG);
  const local = cwd ? readJson(localPath(cwd), { models: [] }) : { models: [] };
  const byId = new Map(base.models.map((m) => [m.id, m]));
  for (const m of local.models || []) byId.set(m.id, { ...byId.get(m.id), ...m });
  return { ...base, models: [...byId.values()] };
}
export function findModel(catalog, id) {
  const base = baseModelId(id);
  return catalog.models.find((m) => m.id === id || m.id === base || Object.values(m.ids || {}).includes(id));
}

/** Providers each installed tool can run without extra setup; '*' means the user chooses (declare the pool). */
export const HOST_PROVIDERS = { claude: ['anthropic'], codex: ['openai'], gemini: ['google'], opencode: ['*'], cursor: ['*'], windsurf: ['*'], generic: [] };

/** Models this project can use: declared (models available …), else inferred from single-provider tools. */
export function modelPool(cwd) {
  const catalog = loadModelCatalog(cwd);
  const declared = loadState(cwd).modelPool;
  if (declared?.length) return { source: 'declared', models: declared.map((id) => findModel(catalog, id)).filter(Boolean) };
  const providers = new Set((loadConfig(cwd).tools || []).flatMap((t) => HOST_PROVIDERS[t] || []).filter((p) => p !== '*'));
  return { source: providers.size ? `inferred from installed tools (${[...providers].join(', ')})` : 'none', models: catalog.models.filter((m) => !m.legacy && providers.has(m.provider)) };
}
export function setPool(cwd, ids, { provider, tier } = {}) {
  const catalog = loadModelCatalog(cwd);
  const unknown = ids.filter((id) => !findModel(catalog, id));
  if (unknown.length && !(provider && tier)) throw new Error(`unknown model(s): ${unknown.join(', ')}. Add them with --provider <name> --tier ${TIERS.join('|')} (prices can be added later in models.local.json)`);
  if (unknown.length) {
    if (!TIERS.includes(tier)) throw new Error(`--tier must be ${TIERS.join(', ')}`);
    const local = readJson(localPath(cwd), { models: [] });
    for (const id of unknown) local.models.push({ id, provider, label: id, tier, strengths: [], price: null, priceVerified: null, source: 'declared by the project' });
    writeJson(localPath(cwd), local);
  }
  const st = loadState(cwd);
  st.modelPool = ids.map((id) => findModel(loadModelCatalog(cwd), id).id);
  saveState(cwd, st);
  return st.modelPool;
}

/** Share of each token kind in this project's recorded usage, or a default from measured agent runs. */
export function tokenMix(cwd) {
  const u = summarizeUsage(readUsage(cwd));
  if (u.all > 100000) { const t = u.total; return { mix: { input: t.input / u.all, cacheWrite: t.cacheWrite / u.all, cacheRead: t.cacheRead / u.all, output: t.output / u.all }, source: 'this project' }; }
  return { mix: { input: 0.04, cacheWrite: 0.04, cacheRead: 0.9, output: 0.02 }, source: 'default (agent sessions are mostly cache reads)' };
}
/** USD per million tokens at the given mix; null when the model has no verified price. */
export function blendedPrice(model, mix) {
  const p = model?.price;
  if (!p || p.input == null || p.output == null) return null;
  return mix.input * p.input + mix.output * p.output + mix.cacheRead * (p.cacheRead ?? p.input * 0.1) + mix.cacheWrite * (p.cacheWrite5m ?? p.input * 1.25);
}

/** What a task needs: the minimum tier and strength, with reasons a person can check. */
export function taskNeeds(task) {
  const role = task.agent || 'developer';
  const base = { architect: 'frontier', developer: 'strong', qa: 'fast', 'ux-designer': 'strong', pm: 'strong', analyst: 'strong', planner: 'strong', researcher: 'strong', marketer: 'fast' }[role] || 'strong';
  let tier = base;
  const reasons = [`${role} work starts at ${base}`];
  const raise = (to, why) => { if (rank(to) > rank(tier)) { tier = to; reasons.push(why); } };
  if (task.risk === 'high') raise('frontier', 'high risk');
  if ((task.qaReturns || 0) >= 1) raise('frontier', `returned by QA ${task.qaReturns} time(s)`);
  if ((task.gates || []).some((g) => /SEC|ASVS|PRIV|GDPR|DPDP|CCPA|PCI|HIPAA|COPPA/.test(g))) raise('frontier', 'security or privacy gate');
  if (role === 'developer' && task.risk === 'low' && task.estimate === 'S' && !(task.gates || []).length && !(task.qaReturns > 0)) { tier = 'fast'; reasons.push('small, low-risk change'); }
  const strength = { developer: 'coding', qa: 'checks', architect: 'reasoning', 'ux-designer': 'ui', researcher: 'reasoning', pm: 'reasoning', analyst: 'reasoning', planner: 'reasoning' }[role];
  const review = task.risk === 'high' ? 'frontier' : task.risk === 'low' ? null : 'strong';
  return { role, tier, strength, review, reasons };
}

/** Outcomes per model and role from the project's history: first-pass rate and cost per task. */
export function modelStats(cwd) {
  const tasks = loadTasks(cwd).tasks;
  const usage = summarizeUsage(readUsage(cwd));
  const stats = {};
  for (const t of tasks.filter((x) => x.status === 'done')) {
    const impl = [...(t.workedBy || [])].reverse().find((w) => w.agent !== 'qa' && w.model) || (t.workedBy || []).find((w) => w.model);
    if (!impl) continue;
    const key = `${baseModelId(impl.model)}|${t.agent || 'developer'}`;
    const s = stats[key] ??= { model: baseModelId(impl.model), role: t.agent || 'developer', done: 0, firstPass: 0, qaReturns: 0, cost: 0, costed: 0 };
    s.done++; s.qaReturns += t.qaReturns || 0; if (!(t.qaReturns > 0)) s.firstPass++;
    if (usage.cost?.byTask?.[t.id] != null) { s.cost += usage.cost.byTask[t.id]; s.costed++; }
  }
  return Object.values(stats).map((s) => ({ ...s, firstPassRate: s.done ? s.firstPass / s.done : null, costPerTask: s.costed ? s.cost / s.costed : null }));
}

/** Recommend a model (and an independent reviewer) for every open task. */
export function recommend(cwd) {
  const pool = modelPool(cwd);
  const { mix, source: mixSource } = tokenMix(cwd);
  const stats = modelStats(cwd);
  // A model that keeps failing a role (3+ tasks, under 60% first pass) is not chosen for that role at its tier.
  const struggling = (model, role) => stats.some((s) => s.model === model.id && s.role === role && s.done >= 3 && s.firstPassRate < 0.6);
  const used = {}; // provider → tasks assigned so far, to spread equally suitable work
  const price = (m) => blendedPrice(m, mix);
  const order = (a, b) => (price(a) ?? Infinity) - (price(b) ?? Infinity) || rank(a.tier) - rank(b.tier) || a.id.localeCompare(b.id);
  const graph = loadTasks(cwd);
  const open = graph.tasks.filter((t) => t.status !== 'done');
  const results = open.map((task) => {
    const need = taskNeeds(task);
    let candidates = pool.models.filter((m) => m.tier && rank(m.tier) >= rank(need.tier));
    const excluded = candidates.filter((m) => struggling(m, need.role));
    if (excluded.length && excluded.length < candidates.length) candidates = candidates.filter((m) => !excluded.includes(m));
    if (!candidates.length) return { id: task.id, title: task.title, need, model: null, reviewer: null, why: pool.models.length ? `no available model reaches ${need.tier}; add one (models available …)` : 'no model pool: declare available models (models available …)' };
    const strong = candidates.filter((m) => !need.strength || (m.strengths || []).includes(need.strength));
    const ranked = (strong.length ? strong : candidates).sort(order);
    // Spread across providers: among models priced within 25% of the cheapest suitable one, prefer the least-used provider.
    const cheapest = price(ranked[0]);
    const close = cheapest == null ? ranked.slice(0, 1) : ranked.filter((m) => price(m) != null && price(m) <= cheapest * 1.25);
    const pick = [...close].sort((a, b) => (used[a.provider] || 0) - (used[b.provider] || 0) || order(a, b))[0];
    used[pick.provider] = (used[pick.provider] || 0) + 1;
    let reviewer = null;
    if (need.review) {
      const pool2 = pool.models.filter((m) => m.tier && rank(m.tier) >= rank(need.review)).sort(order);
      // A different provider when the pool has one; otherwise the cheapest qualifying model in a fresh context.
      reviewer = pool2.find((m) => m.provider !== pick.provider) || pool2[0] || null;
    }
    const why = [...need.reasons, `cheapest available ${need.tier}+ model${need.strength ? ` for ${need.strength}` : ''}${excluded.length ? `; skipped ${excluded.map((m) => m.label || m.id).join(', ')} (low first-pass rate here)` : ''}`];
    if (reviewer) why.push(reviewer.provider !== pick.provider ? `review on a different provider (${reviewer.provider})` : reviewer.id === pick.id ? 'review in a separate context (one provider available)' : 'review on a different model');
    return { id: task.id, title: task.title, need, model: pick, reviewer, why: why.join('; '), alternatives: ranked.filter((m) => m !== pick).slice(0, 2).map((m) => m.id) };
  });
  return { pool, mix, mixSource, stats, tasks: results };
}

/** Write recommendations as each open task's requested model and reviewer; returns the per-role majority for host files. */
export function applyRecommendations(cwd, rec = recommend(cwd)) {
  const graph = loadTasks(cwd);
  const byRole = {};
  for (const r of rec.tasks) {
    const task = graph.tasks.find((t) => t.id === r.id);
    if (!task || !r.model) continue;
    task.model = r.model.id;
    if (r.reviewer) task.reviewModel = r.reviewer.id; else delete task.reviewModel;
    ((byRole[r.need.role] ??= {})[r.model.id] ??= 0); byRole[r.need.role][r.model.id]++;
  }
  saveTasks(cwd, graph);
  const roles = Object.fromEntries(Object.entries(byRole).map(([role, counts]) => [role, Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]]));
  appendLog(cwd, { type: 'note', message: `model routing applied to ${rec.tasks.filter((r) => r.model).length} task(s): ${Object.entries(roles).map(([k, v]) => `${k}=${v}`).join(', ')}` });
  return { roles };
}
