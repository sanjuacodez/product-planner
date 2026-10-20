// Generate a fictional project to preview the self-contained dashboard.
// node examples/demo.js [output-directory]
import path from 'node:path';
import { init } from '../src/init/index.js';
import { writeJson, writeText } from '../src/util/fs.js';
import { defaultState, defaultConfig, appendLog } from '../src/state.js';
import { buildDashboard } from '../src/dashboard/index.js';
const cwd = path.resolve(process.argv[2] || 'output/demo');
await init(cwd, { tools: 'generic', yes: true });
const dir = path.join(cwd, '.product-planner');
const state = defaultState();
state.product = { name: 'Fieldnotes', tagline: 'Turn customer conversations into product decisions', summary: 'A fictional software project demonstrating planning documents, dependency tracking and delivery progress.' };
state.phase = 'build'; for (const key of Object.keys(state.planning)) state.planning[key] = ['marketing'].includes(key) ? 'skipped' : 'done';
state.options.autoOpenDashboard = false;
// Planned model per agent persona; tasks record the model that actually ran them via --model.
state.models = { default: 'claude-opus-5-5', qa: 'claude-sonnet-5-5', 'ux-designer': 'gpt-5-codex' };
writeJson(path.join(dir, 'state.json'), state);
const config = defaultConfig(); config.dashboard.autoRefreshSeconds = 0;
writeJson(path.join(dir, 'config.json'), config);
const epics = [{ id: 'E1', title: 'Workspace foundation', order: 1 }, { id: 'E2', title: 'Research workflow', order: 2 }, { id: 'E3', title: 'Delivery and release', order: 3 }];
const descriptions = ['Initialize application and test commands', 'Implement session authentication', 'Add workspace permissions', 'Capture customer interview notes', 'Tag and search insights', 'Connect the demo import provider', 'Export a decision brief', 'Verify accessibility and responsive layouts', 'Document setup and prepare release'];
const states = ['done', 'done', 'done', 'done', 'in_progress', 'blocked', 'todo', 'review', 'todo'];
const workers = (i) => states[i] === 'todo' ? [] : [{ agent: i === 7 ? 'ux-designer' : 'developer', model: i === 7 ? 'gpt-5-codex' : 'claude-opus-5-5' }, ...(['done', 'review'].includes(states[i]) && i !== 7 ? [{ agent: 'qa', model: 'claude-sonnet-5-5' }] : [])];
const tasks = descriptions.map((title, i) => ({ id: `T${i + 1}`, epic: `E${Math.floor(i / 3) + 1}`, title, description: 'Implement the approved requirement and verify its user-facing behavior.', acceptance: ['The documented user journey works in the local environment.', 'Relevant automated checks pass.'], agent: i === 7 ? 'ux-designer' : 'developer', workedBy: workers(i), priority: i < 3 ? 'high' : 'medium', estimate: 'S', dependsOn: [[], ['T1'], ['T2'], ['T1'], ['T4'], ['T4'], ['T5'], ['T4'], ['T7', 'T8']][i], features: [['F1'], ['F1'], ['F1'], ['F2'], ['F3'], ['F4'], ['F5'], ['F2', 'F3', 'F5'], ['F5']][i], status: states[i], notes: [], ...(states[i] === 'done' ? { completedAt: `2026-10-${16 + Math.max(0, i)}T10:00:00Z` } : states[i] !== 'todo' ? { startedAt: '2026-10-19T11:00:00Z' } : {}), ...(states[i] === 'blocked' ? { blockedReason: 'Demo import provider credentials unavailable; local import remains usable.' } : {}) }));
writeJson(path.join(dir, 'tasks.json'), { version: 1, epics, tasks });
const feature = (id, title, priority, release, status, extra = {}) => ({ id, title, priority, release, status, acceptance: status === 'accepted' ? ['The documented journey works end to end.'] : [], openQuestions: [], assumptions: [], source: 'user', ...extra });
writeJson(path.join(dir, 'features.json'), { version: 1, features: [
  feature('F1', 'Team workspaces', 'must', 'MVP', 'accepted', { story: 'As a product lead, I want a private workspace so that my team shares one evidence base.' }),
  feature('F2', 'Interview capture', 'must', 'MVP', 'accepted'),
  feature('F3', 'Tag and search insights', 'must', 'MVP', 'accepted', { assumptions: ['Keyword search is enough for the MVP'] }),
  feature('F4', 'Import from interview tools', 'should', 'MVP', 'accepted'),
  feature('F5', 'Decision brief export', 'must', 'MVP', 'accepted'),
  feature('F6', 'Comments on insights', 'should', 'Next', 'deferred'),
  feature('F7', 'AI insight clustering', 'could', 'Later', 'deferred'),
  feature('F8', 'Public decision pages', 'wont', 'Later', 'rejected'),
] });
writeText(path.join(dir, 'log.jsonl'), '');
for (const task of tasks) appendLog(cwd, { ts: '2026-10-15T08:00:00Z', type: 'task', task: task.id, from: null, to: 'todo' });
for (let i = 0; i < 4; i++) {
  appendLog(cwd, { ts: `2026-10-${16 + i}T09:00:00Z`, type: 'task', task: tasks[i].id, from: 'todo', to: 'in_progress', agent: 'developer', model: 'claude-opus-5-5' });
  appendLog(cwd, { ts: `2026-10-${16 + i}T10:00:00Z`, type: 'task', task: tasks[i].id, from: 'review', to: 'done', note: 'Acceptance checks passed', agent: 'qa', model: 'claude-sonnet-5-5' });
}
appendLog(cwd, { ts: '2026-10-19T11:00:00Z', type: 'task', task: 'T5', from: 'todo', to: 'in_progress', agent: 'developer', model: 'claude-opus-5-5' });
appendLog(cwd, { ts: '2026-10-19T11:30:00Z', type: 'task', task: 'T8', from: 'in_progress', to: 'review', agent: 'ux-designer', model: 'gpt-5-codex', note: 'Keyboard and 320px layouts checked' });
writeText(path.join(dir, 'roadmap.md'), '# Release roadmap\n\nFictional plan. The MVP is the approved build; later phases are proposals revisited after launch.\n\n## MVP (current build)\n- Workspaces with session sign-in\n- Interview capture, tagging and search\n- Decision brief export\n\n**Exit criteria:** five pilot teams publish a brief without help.\n\n## Next release\n- Team review and comments on insights\n- Saved filters and shared views\n- Import from a second interview provider\n\n## Later opportunities\n- AI-assisted insight clustering (evaluate after usage data)\n- Integrations with issue trackers\n- Public decision pages\n\n## Review triggers\n- Revisit after 30 days of pilot usage or if import volume exceeds plan.\n');
writeText(path.join(dir, 'risks.md'), '| Risk | Mitigation |\n|---|---|\n| Import provider credentials | Use local fixtures until provisioned |\n');
writeText(path.join(dir, 'decisions.md'), '# Decisions\n\nUse session cookies and workspace-scoped permissions. Keep external imports behind a provider interface.\n');
writeText(path.join(dir, 'concept.md'), '# Product concept\n\nHelp small product teams organize customer evidence and write traceable decisions.\n\nThis dashboard contains fictional demonstration data.\n');
writeJson(path.join(dir, 'dashboard', 'endpoints.json'), { title: 'API endpoints', order: 10, tab: 'tasks', type: 'table', columns: ['Endpoint', 'Method', 'Status'], rows: [['/sessions', 'POST', 'Done'], ['/interviews', 'POST', 'Done'], ['/insights/search', 'GET', 'In progress'], ['/briefs/export', 'POST', 'Planned']] });
writeJson(path.join(dir, 'research', 'competitors.json'), [
  { name: 'Example Insights Hub', positioning: 'Research repository for large teams', pricing: 'Per seat, annual', strengths: ['Mature tagging', 'Enterprise permissions'], weaknesses: ['Heavy setup for small teams'] },
  { name: 'Example Notes App', positioning: 'General note taking', pricing: 'Free tier', strengths: ['Familiar editor'], weaknesses: ['No decision traceability'] },
]);
writeText(path.join(dir, 'research', 'market.md'), '# Market research\n\nFictional summary: small product teams keep interview evidence in general-purpose notes and lose the link between evidence and decisions.\n');
console.log(buildDashboard(cwd));
