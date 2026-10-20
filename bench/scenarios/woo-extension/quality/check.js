#!/usr/bin/env node
// Quality-check wrapper for the woo-extension scenario. Never shown to the agent.
//
//   node check.js setup    --tools <dir>                      install pinned tools (idempotent)
//   node check.js phpcs    --tools <dir> --target <plugin>    WordPress coding standards, pass = 0 errors
//   node check.js phpcompat --tools <dir> --target <plugin>   PHPCompatibilityWP for PHP 7.4+, pass = 0 errors
//   node check.js phpstan  --tools <dir> --target <plugin>    PHPStan level 5 + WordPress/WooCommerce stubs
//
// Every check prints one JSON line {"name","pass","errors","details"} and exits 0 only on pass.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const [cmd, ...rest] = process.argv.slice(2);
const opt = (name, dflt) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : dflt; };
const tools = path.resolve(opt('tools', process.env.BENCH_TOOLS || path.join(os.homedir(), '.cache', 'pp-bench-tools')));
const target = path.resolve(opt('target', 'min-order-by-role'));
const php = opt('php', process.env.BENCH_PHP || 'php');
const IGNORE = '*/vendor/*,*/node_modules/*,*/tests/*,*/test/*,*/.git/*';

const emit = (name, pass, errors, details) => {
  console.log(JSON.stringify({ name, pass, errors, details }));
  process.exit(pass ? 0 : 1);
};
const run = (bin, args, extra = {}) => spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 10 * 60 * 1000, ...extra });
const json = (text) => { const at = text.indexOf('{'); try { return at >= 0 ? JSON.parse(text.slice(at)) : null; } catch { return null; } };
const vendorBin = (rel) => path.join(tools, 'vendor', rel);

function requireTarget(name) {
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) emit(name, false, 1, { message: `plugin folder not found: ${target}` });
}
function requireTools(name) {
  if (!fs.existsSync(vendorBin('autoload.php'))) emit(name, false, 1, { message: `tools not installed in ${tools}; run: node check.js setup --tools ${tools}` });
}

function setup() {
  fs.mkdirSync(tools, { recursive: true });
  const digest = (f) => (fs.existsSync(f) ? crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex') : '');
  const lockSrc = path.join(here, 'composer.lock');
  const fresh = digest(lockSrc) === digest(path.join(tools, 'composer.lock')) && fs.existsSync(vendorBin('autoload.php'));
  if (!fresh) {
    fs.copyFileSync(path.join(here, 'composer.json'), path.join(tools, 'composer.json'));
    fs.copyFileSync(lockSrc, path.join(tools, 'composer.lock'));
    const r = run(process.env.BENCH_COMPOSER || 'composer', ['install', '--no-interaction', '--no-progress', `--working-dir=${tools}`]);
    if (r.status !== 0) emit('setup', false, 1, { tools, message: (r.stderr || r.stdout).slice(-1500) });
  }
  const ver = run(php, ['-r', 'echo PHP_VERSION;']).stdout;
  emit('setup', true, 0, { tools, reused: fresh, php: ver });
}

function phpcs(name, standardArgs) {
  requireTarget(name);
  requireTools(name);
  const r = run(php, [vendorBin('squizlabs/php_codesniffer/bin/phpcs'), ...standardArgs, '--report=json', '-q', '--extensions=php', `--ignore=${IGNORE}`, `--basepath=${target}`, target]);
  const report = json(r.stdout);
  if (!report) emit(name, false, 1, { message: 'phpcs produced no JSON report', output: (r.stdout + r.stderr).slice(-1500) });
  const bySource = {};
  const first = [];
  for (const [file, data] of Object.entries(report.files)) {
    for (const m of data.messages) {
      if (m.type !== 'ERROR') continue;
      bySource[m.source] = (bySource[m.source] ?? 0) + 1;
      if (first.length < 15) first.push(`${file}:${m.line} ${m.source}: ${m.message}`);
    }
  }
  const top = Object.fromEntries(Object.entries(bySource).sort((a, b) => b[1] - a[1]).slice(0, 15));
  emit(name, report.totals.errors === 0, report.totals.errors, { warnings: report.totals.warnings, files: Object.keys(report.files).length, bySource: top, first });
}

function phpstan() {
  const name = 'phpstan-level5';
  requireTarget(name);
  requireTools(name);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-phpstan-'));
  try {
    const config = path.join(dir, 'phpstan.neon');
    // Constants the plugin define()s (usually in its main file) are only known to PHPStan when
    // bootstrapped; declare them so using them in other files is not reported as an error.
    const phpFiles = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => ['vendor', 'node_modules'].includes(e.name) ? [] : e.isDirectory() ? phpFiles(path.join(d, e.name)) : e.name.endsWith('.php') ? [path.join(d, e.name)] : []);
    const constants = [...new Set(phpFiles(target).flatMap((f) => [...fs.readFileSync(f, 'utf8').matchAll(/\bdefine\s*\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g)].map((m) => m[1])))];
    const bootstrap = path.join(dir, 'constants.php');
    fs.writeFileSync(bootstrap, `<?php\n${constants.map((c) => `if (!defined('${c}')) { define('${c}', ''); }`).join('\n')}\n`);
    fs.writeFileSync(config, [
      'includes:',
      `\t- ${vendorBin('szepeviktor/phpstan-wordpress/extension.neon')}`,
      `\t- ${path.join(here, 'phpstan.neon')}`,
      'parameters:',
      '\tpaths:',
      `\t\t- ${target}`,
      '\tbootstrapFiles:',
      `\t\t- ${bootstrap}`,
      ...(constants.length ? ['\tdynamicConstantNames:', ...constants.map((c) => `\t\t- ${c}`)] : []),
      `\ttmpDir: ${path.join(dir, 'cache')}`,
      '',
    ].join('\n'));
    const r = run(php, [vendorBin('phpstan/phpstan/phpstan'), 'analyse', '-c', config, '--no-progress', '--no-ansi', '--error-format=json', '--memory-limit=2G'], { env: { ...process.env, BENCH_TOOLS: tools } });
    const report = json(r.stdout);
    if (!report) emit(name, false, 1, { message: 'phpstan produced no JSON report', output: (r.stdout + r.stderr).slice(-1500) });
    const first = [...report.errors.map((e) => `general: ${e}`)];
    for (const [file, data] of Object.entries(report.files)) for (const m of data.messages) if (first.length < 15) first.push(`${path.relative(target, file)}:${m.line} ${m.message}${m.identifier ? ` [${m.identifier}]` : ''}`);
    const errors = report.totals.errors + report.totals.file_errors;
    emit(name, errors === 0, errors, { first });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (cmd === 'setup') setup();
else if (cmd === 'phpcs') phpcs('phpcs-wordpress', ['--standard=WordPress']);
else if (cmd === 'phpcompat') phpcs('php-compatibility-7.4', ['--standard=PHPCompatibilityWP', '--runtime-set', 'testVersion', '7.4-']);
else if (cmd === 'phpstan') phpstan();
else { console.error('usage: node check.js <setup|phpcs|phpcompat|phpstan> --tools <dir> [--target <plugin dir>]'); process.exit(2); }
