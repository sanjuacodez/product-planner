import path from 'node:path';
import { loadState, saveState, stateDir, appendLog, PLANNING_STEPS } from './state.js';
import { readText, readJson, nowIso } from './util/fs.js';
import { hash } from './evidence.js';

const DEPTHS = {
  direct: { documents: ['request.md', 'features.json', 'tasks.json'], roles: ['developer (plans, implements and tests in one pass)', 'qa by risk'] },
  quick: { documents: ['request.md', 'concept.md', 'plan.md', 'decisions.md', 'features.json', 'tasks.json'], roles: ['analyst+pm+architect+planner (one focused pass)', 'developer', 'qa by risk'] },
  standard: { documents: ['request.md', 'concept.md', 'prd.md', 'ux.md', 'architecture.md', 'roadmap.md', 'risks.md', 'decisions.md', 'features.json', 'tasks.json'], roles: ['analyst', 'pm', 'ux-designer', 'architect', 'planner', 'developer', 'qa'] },
};
export function planningProfile(cwd) {
  const state = loadState(cwd);
  const track = state.options?.track;
  const depth = state.options?.planningDepth || (['quick', 'direct'].includes(track) ? track : 'standard');
  if (!DEPTHS[depth]) throw new Error(`options.planningDepth must be ${Object.keys(DEPTHS).join(', ')}`);
  return {
    depth, existing: track === 'existing', ...DEPTHS[depth],
    invariants: ['Original request preserved verbatim', 'Product goal, constraints and non-goals recorded', 'Agreed features and observable acceptance traced to tasks', 'Final request and feature acceptance audit'],
  };
}

const SECTION = { 'prd.md': 'Requirements', 'ux.md': 'UX', 'architecture.md': 'Architecture', 'roadmap.md': 'Roadmap', 'risks.md': 'Risks' };
/** Quick plans have one canonical design document; existing full documents remain untouched. */
export function planningText(cwd, file) {
  if (SECTION[file] && planningProfile(cwd).depth === 'quick') {
    const plan = readText(path.join(stateDir(cwd), 'plan.md'), '');
    const match = plan.match(new RegExp(`^## ${SECTION[file]}[^\\n]*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm'));
    if (match) return `# ${SECTION[file]}\n${match[1].trim()}`;
  }
  return readText(path.join(stateDir(cwd), file), '');
}

/** Approve the plan: requires a passing plan check, marks the remaining planning steps, records
 * a lock snapshot of the agreed request, scope and tasks, and moves to build. Changes after
 * this go through pp-replan, which approves again. */
export function approvePlan(cwd, { reason, check }) {
  if (!reason?.trim()) throw new Error('--reason "…" is required: who approved and how (for example "user approved the plan in chat")');
  if (!readJson(path.join(stateDir(cwd), 'tasks.json'), { tasks: [] }).tasks.length) throw new Error('approve requires a nonempty task plan');
  const result = check(cwd);
  if (result.errors.length) throw new Error(`plan check fails:\n${result.errors.join('\n')}`);
  const state = loadState(cwd);
  for (const step of PLANNING_STEPS) state.planning[step] = state.planning[step] === 'in_progress' || ['tasks', 'handoff'].includes(step) ? 'done' : state.planning[step] === 'pending' ? 'skipped' : state.planning[step];
  state.lock = { at: nowIso(), reason: reason.trim(), ...lockHashes(cwd) };
  const from = state.phase;
  state.phase = 'build';
  saveState(cwd, state);
  appendLog(cwd, { type: 'phase', from, to: 'build', message: `plan approved: ${reason.trim()}` });
  return { lock: state.lock, warnings: result.warnings };
}
export function lockHashes(cwd) {
  const dir = stateDir(cwd);
  const h = (file) => hash(readText(path.join(dir, file), ''));
  const tasks = readJson(path.join(dir, 'tasks.json'), { tasks: [] }).tasks.map(({ id, title, acceptance, features, dependsOn }) => ({ id, title, acceptance, features, dependsOn }));
  return { request: h('request.md'), features: h('features.json'), tasks: hash(JSON.stringify(tasks)) };
}
/** What changed in the agreed plan since approval (empty when nothing did, or when never approved). */
export function lockDrift(cwd) {
  const lock = loadState(cwd).lock;
  if (!lock) return [];
  const now = lockHashes(cwd);
  return ['request', 'features', 'tasks'].filter((k) => lock[k] !== now[k]);
}
