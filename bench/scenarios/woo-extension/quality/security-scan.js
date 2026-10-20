#!/usr/bin/env node
// Marketplace-quality scan for the woo-extension scenario. Never shown to the agent.
//
//   node security-scan.js --target <workspace>/min-order-by-role [--php php] [--verbose]
//
// Facts come from PHP's own tokenizer (scan-tokens.php); uninstall clean-up is checked by running
// the plugin's uninstall path against the hidden WordPress stubs (../hidden/run.php).
// Prints one JSON line: {"name","pass","errors","details"} and exits 0 only when errors is 0.
// Heuristic by design; see README.md "Known limits".
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : dflt; };
const target = path.resolve(opt('target', 'min-order-by-role'));
const php = opt('php', process.env.BENCH_PHP || 'php');
const verbose = argv.includes('--verbose');
const slug = path.basename(target);
const mainFile = path.join(target, `${slug}.php`);
const OPTION = 'min_order_by_role_minimums';

const checks = {};
const add = (check, msg, severity = 'error') => { (checks[check] ??= { errors: [], warnings: [] })[severity === 'error' ? 'errors' : 'warnings'].push(msg); };
const ensure = (...names) => names.forEach((n) => { checks[n] ??= { errors: [], warnings: [] }; });

function finish() {
  const errors = Object.values(checks).reduce((s, c) => s + c.errors.length, 0);
  const details = Object.fromEntries(Object.entries(checks).map(([k, v]) => [k, { pass: v.errors.length === 0, errors: verbose ? v.errors : v.errors.slice(0, 8), warnings: verbose ? v.warnings : v.warnings.slice(0, 5), errorCount: v.errors.length }]));
  console.log(JSON.stringify({ name: 'security-scan', pass: errors === 0, errors, details }));
  process.exit(errors === 0 ? 0 : 1);
}

if (!fs.existsSync(mainFile)) {
  add('structure', `main plugin file not found: ${slug}/${slug}.php`);
  finish();
}

const scan = spawnSync(php, [path.join(here, 'scan-tokens.php'), target], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
if (scan.status !== 0) { add('structure', `token scan failed: ${scan.stderr.slice(0, 300)}`); finish(); }
const facts = JSON.parse(scan.stdout);
const files = facts.files;
const allCalls = files.flatMap((f) => f.calls.map((c) => ({ ...c, file: f.path })));
const lname = (c) => c.name.toLowerCase();
const calls = (...names) => allCalls.filter((c) => names.includes(lname(c)));
const where = (x) => `${x.file ?? x.path}:${x.line}`;

ensure('syntax', 'direct-access', 'input-sanitised', 'nonce-or-settings-api', 'capability-checks', 'output-escaped', 'prefixing', 'i18n', 'uninstall', 'woo-headers-hpos', 'dangerous-code');

// ---------------------------------------------------------------- syntax.
for (const f of files) if (f.parse_error) add('syntax', `${f.path}: ${f.parse_error}`);

// ------------------------------------------------- direct file access guard.
for (const f of files) {
  if (f.has_code && !f.has_guard && !f.namespace) add('direct-access', `${f.path}: no defined('ABSPATH') || exit guard`);
  else if (f.has_code && !f.has_guard) add('direct-access', `${f.path}: no defined('ABSPATH') || exit guard`, 'warning');
}

// ------------------------------------------------- superglobal sanitising.
const reads = files.flatMap((f) => f.superglobals.map((s) => ({ ...s, file: f.path })));
for (const r of reads) {
  if (r.only_check || r.compared) continue;
  if (r.var === '$_SERVER' && /^(REQUEST_METHOD)$/.test(r.key ?? '')) continue;
  if (!r.sanitized) add('input-sanitised', `${where(r)}: ${r.var}${r.key ? `['${r.key}']` : ''} used without sanitising (inside: ${r.enclosing.join(' < ') || 'nothing'})`);
  else if (!r.enclosing.map((e) => e.toLowerCase()).includes('wp_unslash') && ['$_POST', '$_GET', '$_REQUEST', '$_COOKIE'].includes(r.var) && !r.enclosing.some((e) => /^(absint|intval|floatval|wp_verify_nonce|check_admin_referer|sanitize_key|in_array|array_key_exists|is_numeric)$/i.test(e))) {
    add('input-sanitised', `${where(r)}: ${r.var}${r.key ? `['${r.key}']` : ''} sanitised without wp_unslash()`, 'warning');
  }
}

// --------------------------------------- nonce, settings API, capabilities.
const hookCalls = calls('add_action', 'add_filter');
const hookNames = hookCalls.map((c) => c.literals[0]).filter(Boolean);
const adminHandlers = hookCalls.filter((c) => /^(admin_post_|wp_ajax_)/.test(c.literals[0] ?? ''));
const wcSettingsApi =
  files.some((f) => f.classes.some((c) => /^(WC_Settings_Page|WC_Integration|WC_Settings_API)$/i.test(c.extends ?? ''))) ||
  calls('woocommerce_update_options', 'woocommerce_admin_fields', 'wc_admin_settings::save_fields', 'wc_admin_settings::output_fields').length > 0 ||
  hookNames.some((h) => /^woocommerce_(get_settings_|settings_tabs_array|get_sections_|get_settings_pages|settings_tabs_|update_options_)/.test(h));
const wpSettingsApi = calls('register_setting').length > 0;
const nonceCalls = calls('wp_verify_nonce', 'check_admin_referer', 'check_ajax_referer');
const capCalls = calls('current_user_can', 'user_can', 'wc_rest_check_manager_permissions');
const formReads = reads.filter((r) => ['$_POST', '$_REQUEST', '$_FILES'].includes(r.var) && !r.only_check);
const filesWithFormReads = [...new Set(formReads.map((r) => r.file))];

// WooCommerce verifies the "woocommerce-settings" nonce and manage_woocommerce before firing its
// settings save hooks, so form reads in a file that only saves through those hooks are downgraded
// to warnings here (phpcs still reports them under WordPress.Security.NonceVerification).
const wcSaveHook = (h) => /^woocommerce_(update_options|settings_save)_/.test(h ?? '');
for (const file of filesWithFormReads) {
  const fileHooks = hookCalls.filter((c) => c.file === file).map((c) => c.literals[0]);
  const severity = fileHooks.some(wcSaveHook) && !fileHooks.some((h) => /^(admin_init|admin_post_|wp_ajax_|init$|wp_loaded$|template_redirect$)/.test(h ?? '')) ? 'warning' : 'error';
  const lines = formReads.filter((r) => r.file === file).map((r) => `line ${r.line}`).join(', ');
  if (!nonceCalls.some((c) => c.file === file)) add('nonce-or-settings-api', `${file}: reads form data (${lines}) without wp_verify_nonce/check_admin_referer${severity === 'warning' ? ' (inside a WooCommerce settings save hook, which checks the nonce)' : ''}`, severity);
  if (!capCalls.some((c) => c.file === file)) add('capability-checks', `${file}: processes form data without a current_user_can() check${severity === 'warning' ? ' (inside a WooCommerce settings save hook, which requires manage_woocommerce)' : ''}`, severity);
}
if (adminHandlers.length && !nonceCalls.length) add('nonce-or-settings-api', `admin-post/AJAX handlers (${adminHandlers.map((c) => c.literals[0]).join(', ')}) but no nonce verification anywhere`);
if (adminHandlers.length && !capCalls.length) add('capability-checks', `admin-post/AJAX handlers (${adminHandlers.map((c) => c.literals[0]).join(', ')}) but no capability check anywhere`);
if (!wcSettingsApi && !wpSettingsApi && !formReads.length) add('nonce-or-settings-api', 'no settings save path found (WooCommerce settings API, register_setting or a nonce-checked form handler)');
for (const c of calls('add_menu_page', 'add_submenu_page', 'add_options_page', 'add_management_page')) {
  const capIdx = lname(c) === 'add_submenu_page' ? 3 : 2;
  const cap = c.literals[capIdx];
  if (cap !== null && cap !== undefined && /^(read|exist|level_0|)$/.test(cap)) add('capability-checks', `${where(c)}: admin page registered with weak capability '${cap}'`);
}

// ---------------------------------------------------------------- output.
for (const f of files) for (const e of f.echo_issues) add('output-escaped', `${f.path}:${e.line}: ${e.text}`);

// ------------------------------------------------------------- prefixing.
const slugTokens = [slug.replace(/-/g, '_'), slug.replace(/-/g, ''), slug.split('-').map((w) => w[0]).join('')].map((s) => s.toLowerCase());
const reserved = new Set(['wp', 'wc', 'woo', 'woocommerce', 'wordpress', 'get', 'set', 'add', 'update', 'delete', 'remove', 'check', 'is', 'has', 'do', 'the', 'my', 'plugin', 'custom', 'init', 'admin', 'cart', 'order', 'min', 'max', 'minimum', 'settings', 'setting', 'class', 'main', 'helper', 'helpers', 'util', 'utils', 'role', 'roles', 'user', 'save', 'render', 'load', 'register', 'validate', 'show', 'display', 'option', 'options']);
const firstSeg = (name) => name.replace(/^([A-Z][a-z0-9]+)(?=[A-Z])/, '$1_').split(/[_\\]/)[0].toLowerCase();
const globals = [
  ...files.filter((f) => !f.namespace).flatMap((f) => [
    ...f.functions.map((x) => ({ kind: 'function', name: x.name, file: f.path, line: x.line })),
    ...f.classes.map((x) => ({ kind: 'class', name: x.name, file: f.path, line: x.line })),
  ]),
  // define() constants are always global; const declarations in a namespaced file are namespaced.
  ...files.flatMap((f) => f.constants.filter((x) => x.via === 'define' || !f.namespace).map((x) => ({ kind: 'constant', name: x.name, file: f.path, line: x.line }))).filter((c) => !['ABSPATH', 'WPINC'].includes(c.name)),
];
const segs = [...new Set(globals.map((g) => firstSeg(g.name)))];
const vendorPrefix = segs.length === 1 && segs[0].length >= 3 && !reserved.has(segs[0]) ? segs[0] : null;
const prefixes = [...slugTokens, ...(vendorPrefix ? [vendorPrefix] : [])];
const prefixed = (name) => { const n = name.toLowerCase().replace(/\\/g, '_'); return prefixes.some((p) => n === p || n.startsWith(`${p}_`) || n.startsWith(`${p}-`) || (n.startsWith(p) && /^[A-Z]/.test(name.slice(p.length)))); };
for (const g of globals) if (!prefixed(g.name)) add('prefixing', `${where(g)}: global ${g.kind} ${g.name} has no plugin-specific prefix (accepted: ${prefixes.join(', ')})`);
for (const c of calls('update_option', 'add_option', 'set_transient', 'set_site_transient', 'update_site_option', 'add_site_option')) {
  const n = c.literals[0];
  if (n && !prefixed(n)) add('prefixing', `${where(c)}: ${c.name}('${n}') writes an unprefixed option/transient`);
}
for (const c of calls('do_action', 'apply_filters', 'do_action_ref_array', 'apply_filters_ref_array')) {
  const n = c.literals[0];
  if (n && !/^(woocommerce_|wc_|wp_)/.test(n) && !prefixed(n)) add('prefixing', `${where(c)}: custom hook '${n}' is not prefixed`);
}
if (namespaces().length && !globals.length) checks.prefixing.warnings.push(`namespaced: ${namespaces().join(', ')}`);
function namespaces() { return [...new Set(files.map((f) => f.namespace).filter(Boolean))]; }

// ------------------------------------------------------------------ i18n.
const DOMAIN_ARG = { __: 1, _e: 1, esc_html__: 1, esc_html_e: 1, esc_attr__: 1, esc_attr_e: 1, _x: 2, _ex: 2, esc_html_x: 2, esc_attr_x: 2, _n: 3, _nx: 4, _n_noop: 2, _nx_noop: 3 };
const gettext = allCalls.filter((c) => DOMAIN_ARG[c.name] !== undefined);
const mainSrc = fs.readFileSync(mainFile, 'utf8').slice(0, 8192);
const header = (label) => { const m = mainSrc.match(new RegExp(`^[ \\t/*#@]*${label.replace(/ /g, '\\s+')}\\s*:(.*)$`, 'mi')); return m ? m[1].trim() : null; };
if (header('Text Domain') !== slug) add('i18n', `plugin header Text Domain is ${JSON.stringify(header('Text Domain'))}, expected "${slug}"`);
if (!gettext.length) add('i18n', 'no translatable strings (__(), esc_html__() ...) found');
for (const c of gettext) {
  const domain = c.literals[DOMAIN_ARG[c.name]];
  if (c.args.length <= DOMAIN_ARG[c.name]) add('i18n', `${where(c)}: ${c.name}() without a text domain`);
  else if (domain !== slug) add('i18n', `${where(c)}: ${c.name}() uses text domain ${domain === null ? c.args[DOMAIN_ARG[c.name]] : `'${domain}'`}, expected '${slug}'`);
  if (c.literals[0] === null && c.args[0] && !/^_n_noop|_nx_noop$/.test(c.name)) add('i18n', `${where(c)}: ${c.name}() with a non-literal string cannot be extracted for translation`);
}
for (const f of files) for (const b of f.bare_strings) add('i18n', `${f.path}:${b.line}: user-facing string not translatable: ${b.text}`);
if (!calls('load_plugin_textdomain', 'load_textdomain').length) add('i18n', 'no load_plugin_textdomain(): translations outside wordpress.org language packs will not load', 'warning');

// --------------------------------------------------- uninstall clean-up.
function runHidden(spec) {
  const r = spawnSync(php, [path.join(here, '..', 'hidden', 'run.php')], { input: JSON.stringify({ target: mainFile, ...spec }), encoding: 'utf8', timeout: 30000 });
  const at = r.stdout.lastIndexOf('@@BENCH_RESULT@@');
  if (at < 0) return { errors: [`runner failed: ${r.stderr.slice(0, 300)}`], options: {} };
  return JSON.parse(r.stdout.slice(at + '@@BENCH_RESULT@@'.length));
}
const seeded = { [OPTION]: { customer: '50', guest: '20' } };
const activated = runHidden({ context: 'activate', options: seeded, user: { id: 1, roles: ['administrator'] } });
const baseline = new Set(activated.baseline_options ?? []);
const pluginOptions = Object.keys(activated.options ?? {}).filter((k) => !baseline.has(k));
if (!pluginOptions.includes(OPTION)) pluginOptions.push(OPTION);
const uninstalled = runHidden({ context: 'uninstall', options: { ...activated.options, ...seeded } });
if (uninstalled.errors?.length) add('uninstall', `uninstall raised errors: ${uninstalled.errors.join('; ').slice(0, 300)}`);
if (uninstalled.uninstall_via === 'none') add('uninstall', 'no uninstall.php and no register_uninstall_hook(): settings stay in the database after the plugin is deleted');
for (const o of pluginOptions) if (Object.hasOwn(uninstalled.options ?? {}, o)) add('uninstall', `option '${o}' is left behind after uninstall (via ${uninstalled.uninstall_via ?? 'unknown'})`);
const deactivation = calls('register_deactivation_hook');
if (deactivation.length && files.some((f) => !/uninstall/.test(f.path) && f.calls.some((c) => lname(c) === 'delete_option' && c.literals[0] === OPTION))) {
  add('uninstall', 'settings appear to be deleted on deactivation rather than uninstall', 'warning');
}

// --------------------------------------------- WooCommerce headers, HPOS.
for (const h of ['Plugin Name', 'Version', 'WC requires at least', 'WC tested up to']) if (!header(h)) add('woo-headers-hpos', `main file header is missing "${h}"`);
for (const h of ['Requires at least', 'Requires PHP', 'Requires Plugins', 'License']) if (!header(h)) add('woo-headers-hpos', `main file header is missing "${h}"`, 'warning');
const declares = allCalls.filter((c) => /FeaturesUtil::declare_compatibility$/i.test(c.name));
if (!declares.some((c) => c.literals[0] === 'custom_order_tables')) add('woo-headers-hpos', "no HPOS compatibility declaration (FeaturesUtil::declare_compatibility('custom_order_tables', ...))");
if (!declares.some((c) => c.literals[0] === 'cart_checkout_blocks')) add('woo-headers-hpos', 'no Cart and Checkout blocks compatibility declaration', 'warning');

// ------------------------------------------------------- dangerous code.
for (const c of calls('eval', 'create_function', 'extract', 'exec', 'shell_exec', 'system', 'passthru', 'proc_open', 'popen', 'assert')) add('dangerous-code', `${where(c)}: ${c.name}()`);
for (const c of allCalls.filter((c) => /^\$wpdb->(query|get_results|get_var|get_row|get_col)$/.test(c.name))) {
  const sql = c.args[0] ?? '';
  if (c.literals[0] === null && !/prepare/.test(sql) && /\$|\./.test(sql)) add('dangerous-code', `${where(c)}: ${c.name}() with a dynamic query not built by $wpdb->prepare()`);
}

finish();
