/**
 * Deterministic plan analysis (no model tokens): task graph, feature readiness and coverage,
 * requirement-to-task traceability, vague acceptance wording and unfinished template sections.
 */
import path from 'node:path';
import { stateDir } from './state.js';
import { loadTasks, validateTasks } from './tasks.js';
import { loadFeatures, validateFeatures, readiness, coverage } from './features.js';
import { readText, exists } from './util/fs.js';

// Vague wording (any case) and placeholders (upper case only, so a "todo" app is not flagged).
export const VAGUE = /\b(fast|quick(?:ly)?|user[- ]friendly|intuitive|easy|easily|simple|nice|good|robust|scalable|efficient(?:ly)?|appropriate(?:ly)?|properly|correctly|as needed|etc\.?|and so on|works? well|seamless(?:ly)?|clean(?:ly)?|reasonable|sensible)\b|\b(TBD|TODO|FIXME)\b|\?\?\?/i;
const PLACEHOLDER = 'Replace with concrete project evidence';
const DOCS = ['concept.md', 'prd.md', 'ux.md', 'architecture.md', 'roadmap.md', 'baseline.md'];

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
  }
  // Requirement IDs defined in prd.md must be referenced by at least one task.
  const prd = readText(path.join(dir, 'prd.md'), '');
  const reqIds = [...new Set(prd.match(/\b(?:FR|NFR)-\d+\b/g) || [])];
  const taskText = tasks.tasks.map((t) => [t.title, t.description, ...(t.acceptance || [])].join(' ')).join('\n');
  const removed = (id) => new RegExp(`${id}[^\\n]*\\b(removed|dropped|deferred)\\b`, 'i').test(prd);
  const uncovered = reqIds.filter((id) => id.startsWith('FR-') && !taskText.includes(id) && !removed(id));
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

/** A compact brief for one task: everything a fresh agent needs, without reading whole documents. */
export function taskContext(cwd, id) {
  const dir = stateDir(cwd);
  const tasks = loadTasks(cwd);
  const task = tasks.tasks.find((t) => t.id === id);
  if (!task) throw new Error(`unknown task ${id}`);
  const features = loadFeatures(cwd).features.filter((f) => task.features?.includes(f.id));
  const text = [task.title, task.description, ...(task.acceptance || [])].join(' ');
  const reqIds = new Set(text.match(/\b(?:FR|NFR)-\d+\b/g) || []);
  const prd = readText(path.join(dir, 'prd.md'), '');
  const prdLines = prd.split('\n').filter((l) => [...reqIds].some((r) => l.includes(r)) || features.some((f) => new RegExp(`\\b${f.id}\\b`).test(l)));
  const decisions = readText(path.join(dir, 'decisions.md'), '').split('\n').filter((l) => l.includes(task.id) || features.some((f) => new RegExp(`\\b${f.id}\\b`).test(l)));
  const heads = (file) => (readText(path.join(dir, file), '').match(/^#{1,3} .+$/gm) || []).join(' · ');
  const deps = task.dependsOn.map((d) => tasks.tasks.find((t) => t.id === d)).filter(Boolean);
  const lines = [
    `# ${task.id}: ${task.title}`,
    `epic ${task.epic || '-'} · agent ${task.agent} · priority ${task.priority}${task.risk ? ` · risk ${task.risk}` : ''} · status ${task.status}`,
    task.description ? `\n${task.description}` : '',
    `\n## Acceptance (verify every item; write automated tests first where behaviour is testable)\n${task.acceptance.map((a) => `- ${a}`).join('\n')}`,
    ...features.map((f) => `\n## Feature ${f.id}: ${f.title}\n${f.story || ''}${f.flow?.length ? `\nFlow: ${f.flow.join(' → ')}` : ''}${f.acceptance.length ? `\nFeature acceptance:\n${f.acceptance.map((a) => `- ${a}`).join('\n')}` : ''}${f.assumptions.length ? `\nAssumptions: ${f.assumptions.join('; ')}` : ''}`),
    prdLines.length ? `\n## Requirements (prd.md)\n${prdLines.join('\n')}` : '',
    deps.length ? `\n## Dependencies\n${deps.map((d) => `- ${d.id} ${d.title} [${d.status}]${d.notes?.length ? `: ${d.notes.at(-1).text}` : ''}`).join('\n')}` : '',
    decisions.length ? `\n## Related decisions\n${decisions.join('\n')}` : '',
    task.notes?.length ? `\n## Notes so far\n${task.notes.slice(-5).map((n) => `- ${n.agent ? n.agent + ': ' : ''}${n.text}`).join('\n')}` : '',
    `\n## Read more only if needed\narchitecture.md: ${heads('architecture.md') || '(none)'}\nux.md: ${heads('ux.md') || '(none)'}`,
  ];
  return lines.filter(Boolean).join('\n');
}
