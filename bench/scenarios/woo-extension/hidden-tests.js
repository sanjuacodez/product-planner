// Hidden behaviour tests for the woo-extension scenario. Each test runs the plugin in a fresh PHP
// process against minimal WordPress/WooCommerce stubs (hidden/run.php) and asserts on observable
// behaviour only: notices, checkout errors, rendered settings fields and the stored option.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RUNNER = fileURLToPath(new URL('./hidden/run.php', import.meta.url));
const TARGET = process.env.BENCH_TARGET || path.resolve('min-order-by-role/min-order-by-role.php');
const PHP = process.env.BENCH_PHP || 'php';
const OPTION = 'min_order_by_role_minimums';
const ROLES = ['administrator', 'editor', 'author', 'contributor', 'subscriber', 'customer', 'shop_manager', 'wholesale_customer'];
const MARKER = '@@BENCH_RESULT@@';

function run(spec) {
  const r = spawnSync(PHP, [RUNNER], { input: JSON.stringify({ target: TARGET, ...spec }), encoding: 'utf8', timeout: 30000 });
  if (r.error) throw r.error;
  const at = r.stdout.lastIndexOf(MARKER);
  assert.ok(at >= 0, `runner printed no result (exit ${r.status})\nstdout: ${r.stdout.slice(-2000)}\nstderr: ${r.stderr.slice(-2000)}`);
  const res = JSON.parse(r.stdout.slice(at + MARKER.length));
  res.stderr = r.stderr;
  return res;
}

// Shows PHP errors and unstubbed calls so a stub gap is never mistaken for a plugin bug.
const diag = (res) => JSON.stringify({ errors: res.errors, exceptions: res.exceptions, died: res.died, unknown: res.unknown_calls, warnings: res.warnings.slice(0, 5), notices: res.notices, checkout: res.checkout_errors, targets: res.targets }, null, 1);
const noFatal = (res) => assert.deepEqual(res.errors, [], `PHP errors:\n${diag(res)}`);

const decode = (s) => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
// Tags and entities are removed twice so wc_price() HTML that was (wrongly or rightly) escaped still compares as text.
const text = (s) => { let t = String(s ?? ''); for (let i = 0; i < 2; i++) t = decode(t.replace(/<[^>]*>/g, '')); return t.replace(/\s+/g, ' ').trim(); };
const money = (n) => `$${Number(n).toFixed(2)}`;
const message = (min, sub) => `A minimum order of ${money(min)} is required. Your current subtotal is ${money(sub)}.`;

const user = (...roles) => (roles.length ? { id: 7, roles } : null);
const cart = (options, who, subtotal, extra = {}) => run({ context: 'cart', options: { [OPTION]: options }, user: who, cart: { subtotal, empty: false, ...extra } });
const checkout = (options, who, subtotal) => run({ context: 'checkout', options: { [OPTION]: options }, user: who, cart: { subtotal, empty: false } });

function cartTexts(res) {
  return { notices: res.notices.map((n) => text(n.text)), output: text(res.output) };
}
function assertCartNotice(res, expected) {
  noFatal(res);
  const { notices, output } = cartTexts(res);
  assert.ok(notices.includes(expected) || output.includes(expected), `expected cart notice "${expected}"\n${diag(res)}\noutput: ${output.slice(0, 500)}`);
}
function assertNoCartNotice(res) {
  noFatal(res);
  const { notices, output } = cartTexts(res);
  assert.deepEqual(notices, [], `expected no notice\n${diag(res)}`);
  assert.ok(!/A minimum order of/i.test(output), `expected no minimum-order message in cart output: ${output.slice(0, 500)}`);
}
function assertCheckoutError(res, expected) {
  noFatal(res);
  const errs = res.checkout_errors.map((e) => text(e.text));
  assert.ok(errs.includes(expected), `expected checkout error "${expected}"\n${diag(res)}`);
}
function assertCheckoutAllowed(res) {
  noFatal(res);
  assert.deepEqual(res.checkout_errors, [], `expected checkout to pass\n${diag(res)}`);
  assert.ok(!res.notices.some((n) => n.type === 'error'), `expected no error notices\n${diag(res)}`);
}
const amount = (v) => (v === undefined || v === null || v === '' ? 0 : Number(v));

test('main plugin file loads with WooCommerce active, on the front end and in admin, without PHP errors', () => {
  for (const context of ['load', 'admin-render']) {
    const res = run({ context, options: { [OPTION]: { customer: '50' } }, user: context === 'load' ? user('customer') : user('administrator'), cart: { subtotal: 10 } });
    assert.ok(res.loaded, `plugin did not load in ${context}\n${diag(res)}`);
    noFatal(res);
  }
});

test('cart below the role minimum shows the exact notice with wc_price amounts', () => {
  assertCartNotice(cart({ customer: '50' }, user('customer'), 49.99), message(50, 49.99));
  assertCartNotice(cart({ customer: 75 }, user('customer'), 20), message(75, 20));
});

// Each "no notice" test also checks a control case below the minimum, so a plugin that never
// shows anything cannot pass it.
test('cart exactly at or above the minimum shows no notice', () => {
  assertCartNotice(cart({ customer: '50' }, user('customer'), 49), message(50, 49));
  assertNoCartNotice(cart({ customer: '50' }, user('customer'), 50));
  assertNoCartNotice(cart({ customer: '50.00' }, user('customer'), 50));
  assertNoCartNotice(cart({ customer: '50' }, user('customer'), 120.5));
});

test('checkout below the minimum is rejected with the same text as an error', () => {
  assertCheckoutError(checkout({ customer: '50' }, user('customer'), 30), message(50, 30));
  assertCheckoutError(checkout({ guest: '25' }, null, 24.99), message(25, 24.99));
});

test('checkout at or above the minimum is not blocked', () => {
  assertCheckoutError(checkout({ customer: '50' }, user('customer'), 49.5), message(50, 49.5));
  assertCheckoutAllowed(checkout({ customer: '50' }, user('customer'), 50));
  assertCheckoutAllowed(checkout({ customer: '50' }, user('customer'), 80));
});

test('each role uses its own minimum', () => {
  const options = { customer: '50', wholesale_customer: '200' };
  assertCartNotice(cart(options, user('wholesale_customer'), 150), message(200, 150));
  assertNoCartNotice(cart(options, user('customer'), 150));
  assertCheckoutError(checkout(options, user('wholesale_customer'), 199.99), message(200, 199.99));
  assertCheckoutAllowed(checkout(options, user('customer'), 60));
});

test('visitors who are not logged in use the guest amount, and have no minimum without one', () => {
  assertCartNotice(cart({ guest: '25', customer: '100' }, null, 10), message(25, 10));
  assertNoCartNotice(cart({ guest: '25', customer: '100' }, null, 30));
  assertNoCartNotice(cart({ customer: '100' }, null, 10));
  assertCheckoutAllowed(checkout({ customer: '100' }, null, 10));
});

test('roles without a minimum, empty or zero amounts and a missing option mean no minimum', () => {
  assertCartNotice(cart({ customer: '50', guest: '20' }, user('customer'), 5), message(50, 5));
  assertNoCartNotice(cart({ customer: '50' }, user('subscriber'), 5));
  assertNoCartNotice(cart({ customer: '', guest: '20' }, user('customer'), 5));
  assertNoCartNotice(cart({ customer: '0' }, user('customer'), 5));
  assertNoCartNotice(cart({ customer: 0 }, user('customer'), 5));
  const fresh = run({ context: 'cart', options: {}, user: user('customer'), cart: { subtotal: 5 } });
  assertNoCartNotice(fresh);
  assertCheckoutAllowed(run({ context: 'checkout', options: {}, user: null, cart: { subtotal: 5 } }));
});

test('a customer with several roles gets the highest configured minimum', () => {
  const options = { customer: '50', wholesale_customer: '200', subscriber: '' };
  assertCartNotice(cart(options, user('customer', 'wholesale_customer'), 120), message(200, 120));
  assertCartNotice(cart(options, user('wholesale_customer', 'customer'), 120), message(200, 120));
  assertCartNotice(cart(options, user('subscriber', 'customer'), 40), message(50, 40));
  assertCheckoutError(checkout(options, user('customer', 'wholesale_customer'), 120), message(200, 120));
});

test('decimal minimums compare and format exactly', () => {
  assertCartNotice(cart({ customer: '25.50' }, user('customer'), 25.49), message(25.5, 25.49));
  assertNoCartNotice(cart({ customer: '25.5' }, user('customer'), 25.5));
  assertCheckoutError(checkout({ customer: 99.95 }, user('customer'), 99.9), message(99.95, 99.9));
});

test('an empty cart never shows the notice', () => {
  assertCartNotice(cart({ customer: '50', guest: '50' }, user('customer'), 10), message(50, 10));
  assertNoCartNotice(cart({ customer: '50', guest: '50' }, user('customer'), 0, { empty: true }));
  assertNoCartNotice(cart({ customer: '50', guest: '50' }, null, 0, { empty: true }));
});

test('WooCommerce > Settings shows an amount field for every role and for guests', () => {
  const res = run({ context: 'admin-render', options: { [OPTION]: { customer: '50' } }, user: user('administrator') });
  noFatal(res);
  assert.ok(res.targets.length > 0, `no settings tab or section was added under WooCommerce > Settings (tabs seen: ${res.tabs.join(', ')})\n${diag(res)}`);
  const html = decode(res.output);
  const missing = [...ROLES, 'guest'].filter((k) => !html.includes(`${OPTION}[${k}]`));
  assert.deepEqual(missing, [], `settings output has no ${OPTION}[<role>] field for: ${missing.join(', ')} (targets: ${res.targets.join(', ')})`);
});

test('saving the settings stores per-role amounts in the option and the cart uses them', () => {
  const post = { [OPTION]: Object.fromEntries([...ROLES, 'guest'].map((r) => [r, ''])) };
  Object.assign(post[OPTION], { customer: '40', wholesale_customer: '250.50', guest: '15' });
  const saved = run({ context: 'admin-save', options: {}, user: user('administrator'), post });
  noFatal(saved);
  const stored = saved.options[OPTION];
  assert.ok(stored && typeof stored === 'object', `option ${OPTION} was not saved as an array (targets: ${saved.targets.join(', ')})\n${diag(saved)}`);
  assert.equal(amount(stored.customer), 40);
  assert.equal(amount(stored.wholesale_customer), 250.5);
  assert.equal(amount(stored.guest), 15);
  for (const r of ['subscriber', 'administrator']) assert.ok(!(amount(stored[r]) > 0), `${r} should have no minimum, got ${stored[r]}`);
  assertCartNotice(run({ context: 'cart', options: saved.options, user: user('customer'), cart: { subtotal: 39 } }), message(40, 39));
  assertCartNotice(run({ context: 'cart', options: saved.options, user: null, cart: { subtotal: 14.5 } }), message(15, 14.5));
});

test('saving negative or non-numeric amounts results in no minimum for those roles', () => {
  const post = { [OPTION]: Object.fromEntries([...ROLES, 'guest'].map((r) => [r, ''])) };
  Object.assign(post[OPTION], { customer: '-5', wholesale_customer: 'abc', guest: '20' });
  const saved = run({ context: 'admin-save', options: {}, user: user('administrator'), post });
  noFatal(saved);
  const stored = saved.options[OPTION] || {};
  assert.equal(amount(stored.guest), 20, `valid guest amount was not saved\n${diag(saved)}`);
  assertNoCartNotice(run({ context: 'cart', options: saved.options, user: user('customer'), cart: { subtotal: 1 } }));
  assertNoCartNotice(run({ context: 'cart', options: saved.options, user: user('wholesale_customer'), cart: { subtotal: 1 } }));
  assertCheckoutAllowed(run({ context: 'checkout', options: saved.options, user: user('customer'), cart: { subtotal: 1 } }));
});
