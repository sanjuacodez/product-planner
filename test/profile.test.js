import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { init } from '../src/init/index.js';
import { loadState, saveState } from '../src/state.js';
import { loadCatalog, detectProfiles, setProfiles, loadProfile } from '../src/profile.js';
import { verificationTemplate } from '../src/verification.js';
import { auditTemplate } from '../src/audit.js';
import { buildDashboard } from '../src/dashboard/index.js';

const CLI = path.resolve('bin/product-planner.js');
async function project(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-profile-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  await init(cwd, { tools: 'generic' });
  const st = loadState(cwd); st.options.autoOpenDashboard = false; saveState(cwd, st);
  return cwd;
}
const write = (cwd, file, value) => { const full = path.join(cwd, file); fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, typeof value === 'string' ? value : JSON.stringify(value)); };
const run = (cwd, ...a) => spawnSync(process.execPath, [CLI, ...a], { cwd, encoding: 'utf8' });
const ok = (cwd, ...a) => { const r = run(cwd, ...a); assert.equal(r.status, 0, `${a.join(' ')}\n${r.stderr}${r.stdout}`); return r.stdout; };

test('catalog entries are well formed: unique gate ids per profile, typed gates, sources, legal gates have no acceptance', () => {
  const c = loadCatalog();
  assert.ok(c.questions.length >= 3);
  for (const p of c.profiles) {
    assert.ok(p.id && p.title && p.appliesWhen && p.sources?.length, p.id);
    const ids = p.gates.map((g) => g.id); assert.equal(new Set(ids).size, ids.length, p.id);
    for (const g of p.gates) {
      assert.match(g.id, /^G-[A-Z0-9-]+$/); assert.ok(['automated', 'manual', 'legal'].includes(g.type), g.id);
      if (g.type === 'automated') assert.ok(g.command, g.id);
      if (g.type === 'legal') assert.deepEqual(g.acceptance, []); else assert.ok(g.acceptance.length, g.id);
    }
  }
  for (const id of ['wordpress-plugin', 'woocommerce-extension', 'shopify-app', 'gdpr', 'uk-gdpr', 'ccpa-cpra', 'dpdp-india', 'pci-dss', 'hipaa', 'coppa', 'web-baseline']) assert.ok(c.profiles.some((p) => p.id === id), id);
});

test('detection suggests profiles from plugin headers, manifests and dependencies', async (t) => {
  const cwd = await project(t);
  write(cwd, 'min-order/min-order.php', '<?php\n/**\n * Plugin Name: Min Order\n * Requires Plugins: woocommerce\n */');
  write(cwd, 'shopify.app.toml', 'name = "x"');
  write(cwd, 'package.json', { dependencies: { stripe: '1.0.0', express: '4.0.0' } });
  const ids = detectProfiles(cwd).map((d) => d.id).sort();
  assert.deepEqual(ids, ['node-package', 'pci-dss', 'shopify-app', 'web-baseline', 'woocommerce-extension', 'wordpress-plugin']);
});

test('a selected profile drives architecture decisions, tasks, verification and the audit', async (t) => {
  const cwd = await project(t);
  ok(cwd, 'state', 'set', 'options.track', 'quick');
  write(cwd, '.product-planner/request.md', 'A WooCommerce extension for the Marketplace that sets a minimum order per role.');
  // woocommerce-extension extends wordpress-plugin: both sets of gates apply.
  ok(cwd, 'profile', 'set', 'woocommerce-extension', 'gdpr', '--because', 'sold on the WooCommerce Marketplace; EU merchants and customers');
  const p = loadProfile(cwd);
  assert.deepEqual(p.selected.map((s) => s.id), ['wordpress-plugin', 'woocommerce-extension', 'gdpr']);
  assert.ok(p.gates.some((g) => g.id === 'G-WP-PHPCS') && p.gates.some((g) => g.id === 'G-WOO-HPOS') && p.gates.some((g) => g.id === 'G-GDPR-LEGAL'));
  write(cwd, 'plan.json', {
    features: [{ id: 'F1', title: 'Minimum order', status: 'accepted', priority: 'must', release: 'MVP', requests: ['R1'], acceptance: ['Below the minimum, checkout shows the notice'] }],
    tasks: [{ id: 'T1', title: 'Minimum order', features: ['F1'], risk: 'low', writes: ['min-order/'], acceptance: ['Below the minimum, checkout shows the notice'] }],
  });
  const before = run(cwd, 'plan', 'import', '--file', 'plan.json');
  assert.equal(before.status, 1);
  assert.match(before.stdout, /G-WP-PHPCS .*no architecture decision/); assert.match(before.stdout, /G-WOO-HPOS .*no task delivers it/);
  assert.match(before.stdout, /not yet verified against its official sources/); assert.match(before.stdout, /needs legal review .*G-GDPR-LEGAL/);
  assert.doesNotMatch(before.stdout, /G-GDPR-LEGAL .*no architecture decision/);
  // Architecture names every non-legal gate; tasks deliver them.
  const gates = p.gates.filter((g) => g.type !== 'legal');
  write(cwd, '.product-planner/plan.md', `# Plan\n## Requirements\n### FR-1 (F1)\nMinimum order.\n## Architecture\n### Quality and compliance profile\n${gates.map((g) => `- ${g.id}: decided.`).join('\n')}\n`);
  const half = Math.ceil(gates.length / 2);
  write(cwd, 'plan2.json', { tasks: [
    { id: 'T2', title: 'Tooling and standards', features: ['F1'], risk: 'low', writes: ['composer.json'], gates: gates.slice(0, half).map((g) => g.id), acceptance: ['Standards configured'] },
    { id: 'T3', title: 'Privacy and Woo integration', features: ['F1'], risk: 'medium', writes: ['min-order/privacy.php'], gates: gates.slice(half).map((g) => g.id), acceptance: ['Privacy controls work'] },
  ] });
  assert.match(ok(cwd, 'plan', 'import', '--file', 'plan2.json'), /plan check: ok/);
  ok(cwd, 'profile', 'verify', 'gdpr', '--sources', 'https://eur-lex.europa.eu/eli/reg/2016/679/oj', '--note', 'Articles 6, 15-17, 32 reviewed');
  assert.ok(loadProfile(cwd).selected.find((s) => s.id === 'gdpr').verified);
  // Verification of a task that delivers gates requires evidence per gate.
  const t2 = JSON.parse(fs.readFileSync(path.join(cwd, '.product-planner/tasks.json'), 'utf8')).tasks.find((x) => x.id === 'T2');
  assert.ok(Object.keys(verificationTemplate(t2).checks).includes('gate G-WP-PHPCS'));
  // The audit includes non-legal gate rows; legal items are listed for review, never as passable rows.
  const audit = auditTemplate(cwd);
  assert.ok(audit.criteria.some((r) => r.criterion.startsWith('G-WP-PHPCS:')));
  assert.ok(!audit.criteria.some((r) => r.criterion.startsWith('G-GDPR-LEGAL')));
  assert.deepEqual(audit.legalReview.map((l) => l.gate), ['G-GDPR-LEGAL']);
  // Dashboard shows the profile.
  const html = fs.readFileSync(buildDashboard(cwd), 'utf8');
  assert.match(html, /Quality and compliance profile/); assert.match(html, /needs legal review/); assert.match(html, /verified \d{4}-\d{2}-\d{2} against 1 source/);
});

test('automated gates run and record results; gates can be adjusted or removed with a reason', async (t) => {
  const cwd = await project(t);
  setProfiles(cwd, ['node-package'], 'package.json present');
  ok(cwd, 'profile', 'gate', 'G-NODE-TESTS', '--command', 'node -e "process.exit(0)"');
  ok(cwd, 'profile', 'gate', 'G-NODE-TYPES', '--command', 'node -e "console.error(\'type error\'); process.exit(2)"');
  const r = run(cwd, 'profile', 'run');
  assert.equal(r.status, 1); assert.match(r.stdout, /pass G-NODE-TESTS/); assert.match(r.stdout, /FAIL G-NODE-TYPES[\s\S]*type error/);
  assert.equal(loadProfile(cwd).results['G-NODE-TYPES'].exit, 2);
  assert.notEqual(run(cwd, 'profile', 'gate', 'G-NODE-TYPES', '--remove').status, 0);
  ok(cwd, 'profile', 'gate', 'G-NODE-TYPES', '--remove', '--reason', 'plain JavaScript, no types (user approved)');
  assert.ok(!loadProfile(cwd).gates.some((g) => g.id === 'G-NODE-TYPES'));
  // Re-selecting does not bring a removed gate back.
  setProfiles(cwd, ['node-package'], 'again');
  assert.ok(!loadProfile(cwd).gates.some((g) => g.id === 'G-NODE-TYPES'));
});

test('a request that mentions a platform or regulated data blocks the plan until a profile is chosen or ruled out', async (t) => {
  const cwd = await project(t);
  write(cwd, '.product-planner/request.md', 'A WooCommerce extension for the Marketplace that stores customer data.');
  write(cwd, 'plan.json', { features: [{ id: 'F1', title: 'Min order', status: 'accepted', priority: 'must', release: 'MVP', requests: ['R1'], acceptance: ['Works'] }], tasks: [{ id: 'T1', title: 'Min order', features: ['F1'], risk: 'low', writes: ['x/'], acceptance: ['Works'] }] });
  const r = run(cwd, 'plan', 'import', '--file', 'plan.json');
  assert.equal(r.status, 1); assert.match(r.stdout, /mentions "WooCommerce", "Marketplace", "customer data".*suggested: woocommerce-extension/);
  assert.notEqual(run(cwd, 'plan', 'approve', '--reason', 'x').status, 0);
  ok(cwd, 'profile', 'none', '--because', 'internal demo only; no real customers (user confirmed)');
  assert.match(ok(cwd, 'check'), /ok:/);
  const plain = await project(t); write(plain, '.product-planner/request.md', 'A command-line tip calculator.');
  write(plain, 'plan.json', { features: [{ id: 'F1', title: 'Tip', status: 'accepted', priority: 'must', release: 'MVP', requests: ['R1'], acceptance: ['Works'] }], tasks: [{ id: 'T1', title: 'Tip', features: ['F1'], risk: 'low', writes: ['tip.js'], acceptance: ['Works'] }] });
  assert.match(ok(plain, 'plan', 'import', '--file', 'plan.json'), /plan check: ok/);
});

test('selected profiles are installed as skills for the installed tools; deselected ones are removed', async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-profile-skill-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  await init(cwd, { tools: 'claude,codex' });
  const out = ok(cwd, 'profile', 'set', 'wordpress-plugin', '--because', 'WordPress.org plugin');
  assert.match(out, /skill file\(s\) updated/);
  const skill = fs.readFileSync(path.join(cwd, '.claude/skills/pp-profile-wordpress-plugin/SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: pp-profile-wordpress-plugin\ndescription: /); assert.match(skill, /### G-WP-PHPCS/); assert.match(skill, /Applies because: WordPress\.org plugin/);
  assert.ok(fs.existsSync(path.join(cwd, '.agents/skills/pp-profile-wordpress-plugin/SKILL.md')));
  assert.match(ok(cwd, 'profile', 'show', 'gdpr'), /### G-GDPR-LEGAL: .*\(needs legal review\)/);
  ok(cwd, 'uninstall');
  assert.ok(!fs.existsSync(path.join(cwd, '.claude/skills/pp-profile-wordpress-plugin')));
});

test('a new profile for an uncovered platform: scaffold, validate, save to the library, reuse in another project', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-home-')); t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const env = { ...process.env, PP_HOME: home };
  const pp = (cwd, ...a) => { const r = spawnSync(process.execPath, [CLI, ...a], { cwd, encoding: 'utf8', env }); return r; };
  const a = await project(t);
  assert.equal(pp(a, 'profile', 'new', 'vscode-extension', '--title', 'VS Code extension').status, 0);
  const file = path.join(a, '.product-planner/profiles/vscode-extension/profile.json');
  const v = pp(a, 'profile', 'validate', 'vscode-extension'); assert.equal(v.status, 1); assert.match(v.stdout, /appliesWhen is required/);
  assert.notEqual(pp(a, 'profile', 'save', 'vscode-extension').status, 0);
  const def = JSON.parse(fs.readFileSync(file, 'utf8'));
  Object.assign(def, { appliesWhen: 'An extension published to the VS Code Marketplace.', detect: { files: [], packages: [], requestWords: ['VS Code extension'] },
    sources: [{ title: 'Publishing extensions', url: 'https://code.visualstudio.com/api/working-with-extensions/publishing-extension' }],
    gates: [{ id: 'G-VSCODE-MANIFEST', type: 'manual', title: 'Marketplace manifest fields', architecture: 'Record publisher, engines.vscode and activation events.', acceptance: ['package.json declares publisher, engines.vscode and activation events'] }] });
  fs.writeFileSync(file, JSON.stringify(def));
  assert.equal(pp(a, 'profile', 'validate', 'vscode-extension').status, 0);
  assert.equal(pp(a, 'profile', 'save', 'vscode-extension').status, 0);
  // Another project sees it in the catalog, and its request words trigger the plan check.
  const b = await project(t);
  assert.match(pp(b, 'profile', 'catalog').stdout, /vscode-extension .*\[user library\]/);
  write(b, '.product-planner/request.md', 'Build a VS Code extension that formats YAML.');
  write(b, 'plan.json', { features: [{ id: 'F1', title: 'Format', status: 'accepted', priority: 'must', release: 'MVP', requests: ['R1'], acceptance: ['Formats'] }], tasks: [{ id: 'T1', title: 'Format', features: ['F1'], risk: 'low', writes: ['src/'], acceptance: ['Formats'] }] });
  const r = pp(b, 'plan', 'import', '--file', 'plan.json');
  assert.equal(r.status, 1); assert.match(r.stdout, /mentions "VS Code extension".*suggested: vscode-extension/);
});
