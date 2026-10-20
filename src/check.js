/**
 * Deterministic plan analysis (no model tokens): task graph, feature readiness and coverage,
 * requirement-to-task traceability, vague acceptance wording and unfinished template sections.
 */
import { taskFreshness } from './evidence.js';
import path from 'node:path';
import { stateDir, loadState } from './state.js';
import { loadTasks, validateTasks } from './tasks.js';
import { loadFeatures, validateFeatures, readiness, coverage, requestCoverage } from './features.js';
import { requestItems } from './request.js';
import { profileCheck } from './profile.js';
import { planningText, lockDrift } from './planning.js';
import { readText, exists } from './util/fs.js';

// Vague wording (any case) and placeholders (upper case only, so a "todo" app is not flagged).
export const VAGUE = /\b(fast|quick(?:ly)?|user[- ]friendly|intuitive|easy|easily|simple|nice|good|robust|scalable|efficient(?:ly)?|appropriate(?:ly)?|properly|correctly|as needed|etc\.?|and so on|works? well|seamless(?:ly)?|clean(?:ly)?|reasonable|sensible)\b|\b(TBD|TODO|FIXME)\b|\?\?\?/i;
const PLACEHOLDER = 'Replace with concrete project evidence';
const DOCS = ['concept.md', 'prd.md', 'ux.md', 'architecture.md', 'roadmap.md', 'baseline.md', 'plan.md'];

export function checkPlan(cwd) {
  const dir = stateDir(cwd);
  const errors = [], warnings = [];
  const tasks = loadTasks(cwd);
  const features = loadFeatures(cwd);
  errors.push(...validateTasks(tasks));
  if (features.features.length) {
    errors.push(...validateFeatures(features));
    const r = readiness(features);
    errors.push(...r.errors.map((e) => `feature ${e}`));
    errors.push(...coverage(features, tasks).errors);
    for (const t of tasks.tasks) if (!t.features?.length) warnings.push(`${t.id}: not linked to a feature (set "features")`);
    // Nothing in the original request may be dropped silently.
    const items = requestItems(cwd);
    if (loadState(cwd).options?.requestCoverage && items.length) errors.push(...requestCoverage(features, items).errors.map((e) => `request coverage: ${e}`));
  }
  // Quality profile: each platform/regulatory gate needs an architecture decision and a delivering task.
  const prof = profileCheck(cwd, { architecture: planningText(cwd, 'architecture.md'), tasks: tasks.tasks });
  errors.push(...prof.errors.map((e) => `quality profile: ${e}`)); warnings.push(...prof.warnings.map((w) => `quality profile: ${w}`));
  const drift = lockDrift(cwd);
  if (drift.length) warnings.push(`changed since the plan was approved: ${drift.join(', ')}. Record scope changes with pp-replan and approve again (plan approve).`);
  // Requirement IDs defined in prd.md must be referenced by at least one task.
  const prd = planningText(cwd, 'prd.md');
  const reqIds = [...new Set(prd.match(/\b(?:FR|NFR)-\d+\b/g) || [])];
  const taskText = tasks.tasks.map((t) => [t.title, t.description, ...(t.acceptance || [])].join(' ')).join('\n');
  const removed = (id) => new RegExp(`${id}\\b[^\\n]*\\b(removed|dropped|deferred)\\b`, 'i').test(prd);
  const covered = new Set(taskText.match(/\b(?:FR|NFR)-\d+\b/g) || []);
  const uncovered = reqIds.filter((id) => id.startsWith('FR-') && !covered.has(id) && !removed(id));
  for (const id of uncovered) warnings.push(`${id} in prd.md is not referenced by any task`);
  // Acceptance criteria must be observable.
  const vague = (owner, list) => { for (const a of list || []) { const m = a.match(VAGUE); if (m && !(m[2] && m[2] !== m[2].toUpperCase())) warnings.push(`${owner}: vague acceptance "${a}" ("${m[0]}"; state what is observed, by whom, with numbers)`); } };
  for (const t of tasks.tasks) vague(t.id, t.acceptance);
  for (const f of features.features) if (f.status === 'accepted') vague(f.id, f.acceptance);
  // Unfinished template sections.
  for (const doc of DOCS) { const text = readText(path.join(dir, doc)); if (text?.includes(PLACEHOLDER)) warnings.push(`${doc}: still has unfilled template sections`); }
  if (tasks.tasks.length && !exists(path.join(dir, 'request.md'))) warnings.push('request.md missing: save the user\'s original request verbatim so the final acceptance audit can check it');
  const high = tasks.tasks.filter((t) => t.risk === 'high' && t.status !== 'done').map((t) => t.id);
  return {
    errors, warnings,
    stats: { tasks: tasks.tasks.length, features: features.features.length, requirements: reqIds.length, uncoveredRequirements: uncovered.length, highRisk: high },
  };
}

// IDs are compared as complete tokens: T1/F1/FR-1 must not match T10/F10/FR-10.
const idsIn = (text) => text.match(/\b(?:(?:FR|NFR)-\d+|[TF]\d+)\b/g) || [];
const hasId = (text, ids) => idsIn(text).some((id) => ids.has(id));
const GLOBAL = /constraints|principles|security|privacy|accessibility|non[- ]functional|global|cross[- ]cutting|compatibility/i;

/** Extract complete heading sections or Markdown blocks, preserving multiline rules.
 * Heading selection includes nested headings; list selection includes indented continuation.
 * Nothing is silently truncated to meet a token limit.
 */
function excerpts(text, ids, { globalSections = false, unscoped = false } = {}) {
  const lines = text.split('\n');
  const selected = new Set();
  const heading = (line) => /^(#{1,6})\s+/.exec(line);
  const list = (line) => /^(\s*)(?:[-+*]|\d+[.)])\s+/.exec(line);
  const select = (start, end) => { for (let j = start; j < end; j++) selected.add(j); };
  for (let i = 0; i < lines.length; i++) {
    const h = heading(lines[i]);
    if (h) {
      let end = i + 1;
      while (end < lines.length && !(heading(lines[end])?.[1].length <= h[1].length)) end++;
      if (hasId(lines[i], ids) || (globalSections && GLOBAL.test(lines[i]) && !idsIn(lines[i]).length)) select(i, end);
      // An unrelated explicitly scoped heading owns its children as well.
      else if (idsIn(lines[i]).length) { i = end - 1; }
      continue;
    }
    if (!lines[i].trim()) continue;
    if (/^\s*\|.*\|\s*$/.test(lines[i])) {
      let end = i + 1;
      while (end < lines.length && /^\s*\|.*\|\s*$/.test(lines[end])) end++;
      const headerEnd = /^\s*\|[\s:|\-]+\|\s*$/.test(lines[i + 1] || '') ? i + 2 : i;
      const rows = [];
      for (let j = headerEnd; j < end; j++) {
        if (hasId(lines[j], ids) || (unscoped && !idsIn(lines[j]).length)) rows.push(j);
      }
      if (rows.length) { select(i, headerEnd); for (const j of rows) selected.add(j); }
      i = end - 1;
      continue;
    }
    const item = list(lines[i]);
    let end = i + 1;
    while (end < lines.length && !heading(lines[end])) {
      const next = list(lines[end]);
      if (item ? (next && next[1].length <= item[1].length) || (lines[end].trim() && !/^\s/.test(lines[end])) : !lines[end].trim() || next) break;
      end++;
    }
    const block = lines.slice(i, end).join('\n');
    if (hasId(block, ids) || (unscoped && !idsIn(block).length)) select(i, end);
    i = end - 1;
  }
  // Retain a separator when selected blocks are not adjacent in the source.
  return [...selected].sort((a, b) => a - b).map((i, n, all) => `${n && i > all[n - 1] + 1 ? '\n' : ''}${lines[i]}`).join('\n').trim();
}

/** A brief for one task, with shared product context and complete relevant evidence. */
export function taskContext(cwd, id) {
  const dir = stateDir(cwd);
  const tasks = loadTasks(cwd);
  const task = tasks.tasks.find((t) => t.id === id);
  if (!task) throw new Error(`unknown task ${id}`);
  const state = loadState(cwd);
  const features = loadFeatures(cwd).features.filter((f) => task.features?.includes(f.id));
  const text = [task.title, task.description, ...(task.acceptance || [])].join(' ');
  const refs = new Set([...idsIn(text), ...(task.features || [])]);
  const read = (file) => planningText(cwd, file).replace(/<!--[\s\S]*?-->/g, '').trim();
  const prd = excerpts(read('prd.md'), refs, { globalSections: true });
  const related = new Set([task.id, ...task.dependsOn, ...refs, ...idsIn(prd)]);
  const decisions = excerpts(read('decisions.md'), related, { globalSections: true, unscoped: true });
  const architecture = excerpts(read('architecture.md'), related, { globalSections: true });
  const lessons = excerpts(read('lessons.md'), related);
  const freshness = taskFreshness(cwd, task);
  const ux = excerpts(read('ux.md'), related, { globalSections: true });
  const heads = (file) => (read(file).match(/^#{1,3} .+$/gm) || []).join(' · ');
  const deps = task.dependsOn.map((d) => tasks.tasks.find((t) => t.id === d)).filter(Boolean);
  const concept = read('concept.md');
  const plannedModel = task.model || state.models?.[task.agent] || state.models?.default;
  const lines = [
    `# ${task.id}: ${task.title}`,
    `epic ${task.epic || '-'} · agent ${task.agent} · priority ${task.priority}${task.risk ? ` · risk ${task.risk}` : ''} · status ${task.status}`,
    plannedModel ? `Requested model: ${plannedModel} (preference only; record the actual host model on transitions)${task.reviewModel ? `. Independent review: ${task.reviewModel}` : ''}` : '',
    `\n## Product context (concept.md)\n${concept || `${state.product.name || '(unnamed product)'}: ${state.product.summary || '(concept.md missing; read request.md and recover the agreed goal before implementing)'}`}`,
    `\n## Evidence freshness\n${freshness.status}${freshness.changed.length ? ': ' + freshness.changed.join(', ') : ''}. ${task.sources?.length ? 'Declared sources: ' + task.sources.join(', ') : 'No source paths declared; freshness covers planning files and declared writes only.'}`,
    lessons ? `\n## Relevant lessons (lessons.md; revalidate source evidence)\n${lessons}` : '',
    task.description ? `\n${task.description}` : '',
    `\n## Acceptance (verify every item; write automated tests first where behaviour is testable)\n${task.acceptance.map((a) => `- ${a}`).join('\n')}`,
    ...features.map((f) => `\n## Feature ${f.id}: ${f.title}\n${f.story || ''}${f.flow?.length ? `\nFlow: ${f.flow.join(' → ')}` : ''}${f.acceptance.length ? `\nFeature acceptance:\n${f.acceptance.map((a) => `- ${a}`).join('\n')}` : ''}${f.assumptions.length ? `\nAssumptions: ${f.assumptions.join('; ')}` : ''}${f.openQuestions?.length ? `\nUnresolved questions: ${f.openQuestions.join('; ')}` : ''}`),
    prd ? `\n## Requirements (prd.md)\n${prd}` : '\n## Requirements\nNo matching PRD sections found. Inspect prd.md and request.md before relying on this brief.',
    architecture ? `\n## Architecture and constraints (architecture.md)\n${architecture}` : '',
    ux ? `\n## UX (ux.md)\n${ux}` : '',
    deps.length ? `\n## Dependencies\n${deps.map((d) => `- ${d.id} ${d.title} [${d.status}]\n${d.acceptance.map((a) => `  - ${a}`).join('\n')}${d.notes?.length ? `\n${d.notes.slice(-3).map((n) => `  - Evidence: ${n.text}`).join('\n')}` : ''}`).join('\n')}` : '',
    decisions ? `\n## Related and shared decisions (decisions.md)\n${decisions}` : '',
    task.notes?.length ? `\n## Notes so far\n${task.notes.slice(-5).map((n) => `- ${n.agent ? n.agent + ': ' : ''}${n.text}`).join('\n')}` : '',
    `\n## Source checks\nPaths above are under .product-planner/. Read request.md for exact original wording and later changes. Inspect current affected source and repository instructions before editing; excerpts are context, not proof of source freshness. Record owned output paths before parallel work.`,
    `\n## Read more only if needed\narchitecture.md: ${heads('architecture.md') || '(none)'}\nux.md: ${heads('ux.md') || '(none)'}\nbaseline.md and lessons.md: inspect relevant existing-product evidence.`,
  ];
  return lines.filter(Boolean).join('\n');
}
