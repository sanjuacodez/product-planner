// Fictional existing-product planning fixture for the README screenshots.
// node examples/planning-demo.js [output-directory]
import path from 'node:path';
import { init } from '../src/init/index.js';
import { loadState, saveState, loadConfig, configPath } from '../src/state.js';
import { writeJson, writeText } from '../src/util/fs.js';
import { buildDashboard } from '../src/dashboard/index.js';
const cwd = path.resolve(process.argv[2] || 'output/planning-demo');
await init(cwd, { tools: 'generic', yes: true });
const state = loadState(cwd);
state.product = { name: 'Fieldnotes', tagline: 'Plan the next release from the existing product', summary: 'Fictional planning-state fixture. Current capabilities and roadmap proposals are documented before implementation.' };
state.phase = 'planning';
state.options.autoOpenDashboard = false;
for (const step of Object.keys(state.planning)) state.planning[step] = 'pending';
Object.assign(state.planning, { setup: 'done', concept: 'done', research: 'done', prd: 'in_progress', marketing: 'skipped' });
saveState(cwd, state);
const config = loadConfig(cwd); config.dashboard.autoRefreshSeconds = 0; writeJson(configPath(cwd), config);
const dir = path.join(cwd, '.product-planner');
writeJson(path.join(dir, 'dashboard', 'current-product.json'), {
  title: 'Current product baseline — fictional example', type: 'table', order: 10,
  text: 'Illustrative manually maintained evidence table. This fixture does not run a code scan or connect to a code-intelligence provider.',
  columns: ['Capability', 'Observed state', 'Example source reference', 'Next planning step'],
  rows: [
    ['Interview capture', 'Present in code', 'src/interviews/* (illustrative)', 'Validate the existing workflow'],
    ['Workspace permissions', 'Partial', 'src/auth/* (illustrative)', 'Specify team roles and migration needs'],
    ['Decision brief export', 'Unknown', 'Not inspected in this example', 'Inspect implementation before estimating'],
  ],
});
writeText(path.join(dir, 'roadmap.md'), '## Proposed next release\n\nValidate existing journeys, define team permissions, then scope brief export using the findings. This fictional roadmap is a planning proposal pending review.\n');
console.log(buildDashboard(cwd));
