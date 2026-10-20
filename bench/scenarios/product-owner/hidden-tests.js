// Hidden acceptance tests: copied into the workspace only after the agent has finished.
// "prompt:" tests check behaviour stated in prompt.md; all others check facts the
// product owner gives when asked (facts.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { createLedger } = await import(pathToFileURL(process.env.BENCH_TARGET || path.resolve('loyalty.js')));
const error = (fn, code) => assert.throws(fn, (e) => e instanceof Error && e.code === code);
let seq = 0;
const pid = () => `p${++seq}`;
// Each fact is tested on its own: a 5-rupee warm-up purchase earns only the welcome bonus (if the
// implementation has one), so later expectations do not depend on whether that one fact was learned.
const warm = (l, c, id = pid()) => { l.earn(c, 5, id); return l.balance(c); };
// Exactly 500 lifetime points (silver) whatever the warm-up earned.
const silver = (l, c) => { const b = warm(l, c); l.earn(c, (500 - b) * 10, pid()); return l; };
// Then 6670 rupees at silver: floor(667 x 1.5) = 1000, lifetime 1500 (gold).
const gold = (l, c) => { silver(l, c); l.earn(c, 6670, pid()); return l; };

// ---------- stated in prompt.md ----------
test('prompt: unknown customers start at zero, earn adds its returned points, refund reverses them', () => {
  const l = createLedger();
  assert.equal(l.balance('ann'), 0);
  const n = l.earn('ann', 1000, 'a1');
  assert.ok(Number.isInteger(n) && n > 0);
  assert.equal(l.balance('ann'), n);
  const m = l.earn('ann', 2000, 'a2');
  assert.equal(l.balance('ann'), n + m);
  assert.equal(l.refund('a1'), m);
  assert.equal(l.balance('ann'), m);
});
test('prompt: invalid input throws INVALID_INPUT and changes nothing', () => {
  const l = createLedger();
  const n = l.earn('ann', 1000, 'a1');
  for (const [c, amount, p] of [['', 100, 'x1'], [null, 100, 'x2'], [7, 100, 'x3'], ['ann', 0, 'x4'], ['ann', -5, 'x5'], ['ann', NaN, 'x6'], ['ann', Infinity, 'x7'], ['ann', '100', 'x8'], ['ann', 100, ''], ['ann', 100, 42]]) error(() => l.earn(c, amount, p), 'INVALID_INPUT');
  for (const [c, points] of [['ann', 0], ['ann', -100], ['ann', 1.5], ['ann', '100'], ['', 100]]) error(() => l.redeem(c, points), 'INVALID_INPUT');
  error(() => l.refund(''), 'INVALID_INPUT');
  assert.equal(l.balance('ann'), n);
  l.earn('ann', 100, 'x1'); // a failed earn did not consume its purchaseId
});
test('prompt: a reused purchaseId throws DUPLICATE_PURCHASE for any customer and changes nothing', () => {
  const l = createLedger();
  const n = l.earn('ann', 1000, 'p1');
  error(() => l.earn('ann', 500, 'p1'), 'DUPLICATE_PURCHASE');
  error(() => l.earn('bob', 500, 'p1'), 'DUPLICATE_PURCHASE');
  assert.equal(l.balance('ann'), n);
  assert.equal(l.balance('bob'), 0);
});
test('prompt: redeeming more than the balance throws INSUFFICIENT_POINTS and changes nothing', () => {
  const l = createLedger();
  error(() => l.redeem('nobody', 100), 'INSUFFICIENT_POINTS');
  l.earn('ann', 3000, 'p1');
  const b = l.balance('ann');
  error(() => l.redeem('ann', Math.ceil((b + 1) / 100) * 100), 'INSUFFICIENT_POINTS');
  assert.equal(l.balance('ann'), b);
});
test('prompt: ledgers and customers are independent', () => {
  const a = createLedger(), b = createLedger();
  const n = a.earn('ann', 1000, 'p1');
  assert.equal(b.balance('ann'), 0);
  const m = b.earn('ann', 3000, 'p1');
  assert.equal(a.balance('ann'), n);
  assert.equal(b.balance('ann'), m);
  assert.equal(a.balance('bob'), 0);
  assert.equal(a.refund('p1'), 0);
  assert.equal(b.balance('ann'), m);
});

// ---------- given by the product owner (facts.md) ----------
test('points: bronze earns 1 point per 10 rupees, rounded down per purchase', () => {
  const l = createLedger();
  l.earn('ann', 100, pid());
  assert.equal(l.earn('ann', 250, pid()), 25);
  assert.equal(l.earn('ann', 99, pid()), 9);
  assert.equal(l.earn('ann', 19.99, pid()), 1);
  assert.equal(l.earn('ann', 5, pid()), 0);
});
test('points: the first purchase earns a 20 point welcome bonus, once per customer', () => {
  const l = createLedger();
  assert.equal(l.earn('ann', 100, pid()), 30);
  assert.equal(l.earn('ann', 100, pid()), 10);
  assert.equal(l.earn('bob', 5, pid()), 20);
  assert.equal(l.balance('ann'), 40);
  l.earn('cat', 100, 'first');
  assert.equal(l.refund('first'), 0);
  assert.equal(l.earn('cat', 100, pid()), 10); // not given again after the first purchase is refunded
});
test('tiers: bronze by default, silver at 500 and gold at 1500 lifetime points', () => {
  const l = createLedger();
  assert.equal(l.tier('nobody'), 'bronze');
  const b = warm(l, 'ann');
  l.earn('ann', (499 - b) * 10, pid()); // 499 lifetime points
  assert.equal(l.tier('ann'), 'bronze');
  l.earn('ann', 10, pid()); // 500
  assert.equal(l.tier('ann'), 'silver');
  assert.equal(l.earn('ann', 6660, pid()), 999); // 1499
  assert.equal(l.tier('ann'), 'silver');
  assert.equal(l.earn('ann', 10, pid()), 1); // 1500
  assert.equal(l.tier('ann'), 'gold');
});
test('tiers: tier follows lifetime points, so redeeming never lowers it', () => {
  const l = silver(createLedger(), 'ann');
  assert.equal(l.redeem('ann', 500), 0);
  assert.equal(l.tier('ann'), 'silver');
  assert.equal(l.earn('ann', 100, pid()), 15);
});
test('points: silver 1.5x and gold 2x apply to rounded-down base points, rounded down again', () => {
  const l = silver(createLedger(), 'ann');
  assert.equal(l.earn('ann', 95, pid()), 13);
  assert.equal(l.earn('ann', 100, pid()), 15);
  assert.equal(l.earn('ann', 30, pid()), 4);
  const g = gold(createLedger(), 'bob');
  assert.equal(g.tier('bob'), 'gold');
  assert.equal(g.earn('bob', 95, pid()), 18);
});
test('tiers: an upgrade applies from the next purchase, not the one that crosses the threshold', () => {
  const l = createLedger();
  warm(l, 'ann');
  assert.equal(l.earn('ann', 5000, pid()), 500); // crosses 500 but still earns at bronze
  assert.equal(l.tier('ann'), 'silver');
  assert.equal(l.earn('ann', 1000, pid()), 150);
});
test('redeem: only multiples of 100 points, otherwise REDEEM_STEP and nothing changes', () => {
  const l = silver(createLedger(), 'ann'); // balance 500
  error(() => l.redeem('ann', 150), 'REDEEM_STEP');
  error(() => l.redeem('ann', 1), 'REDEEM_STEP');
  assert.equal(l.balance('ann'), 500);
  assert.equal(l.redeem('ann', 200), 300);
});
test('redeem: the multiple-of-100 check comes before the balance check', () => {
  const l = createLedger();
  warm(l, 'ann');
  l.earn('ann', 300, pid()); // balance at most 50
  error(() => l.redeem('ann', 150), 'REDEEM_STEP');
  error(() => l.redeem('ann', 100), 'INSUFFICIENT_POINTS');
});
test('refunds: remove exactly the points the purchase earned and return the new balance', () => {
  const l = createLedger();
  const b = warm(l, 'ann', 'w');
  assert.equal(l.earn('ann', 1000, 'a1'), 100);
  assert.equal(l.earn('ann', 1000, 'a2'), 100);
  assert.equal(l.refund('a2'), b + 100);
  assert.equal(l.refund('a1'), b);
  assert.equal(l.refund('w'), 0); // the warm-up refund removes its bonus too
});
test('refunds: after redemption the balance goes negative and blocks redeeming', () => {
  const l = createLedger();
  const b = warm(l, 'ann');
  l.earn('ann', 1000, 'a1'); // b + 100
  assert.equal(l.redeem('ann', 100), b);
  assert.equal(l.refund('a1'), b - 100); // negative: not clamped to 0
  assert.equal(l.balance('ann'), b - 100);
  l.earn('ann', 1500, pid()); // +150, balance below 100
  error(() => l.redeem('ann', 100), 'INSUFFICIENT_POINTS');
  assert.equal(l.balance('ann'), b + 50);
});
test('refunds: reduce lifetime points and can move a customer down a tier', () => {
  const l = createLedger();
  const b = warm(l, 'ann');
  l.earn('ann', (500 - b) * 10, 'big'); // lifetime 500, silver
  l.earn('ann', 1000, pid()); // 150 at silver, lifetime 650
  assert.equal(l.tier('ann'), 'silver');
  l.refund('big'); // lifetime 150
  assert.equal(l.tier('ann'), 'bronze');
  assert.equal(l.earn('ann', 1000, pid()), 100);
});
test('refunds: ALREADY_REFUNDED, UNKNOWN_PURCHASE, and a refunded purchaseId stays used', () => {
  const l = createLedger();
  l.earn('ann', 1000, 'a1');
  l.earn('ann', 1000, 'a2');
  l.refund('a1');
  error(() => l.refund('a1'), 'ALREADY_REFUNDED');
  error(() => l.refund('missing'), 'UNKNOWN_PURCHASE');
  assert.equal(l.balance('ann'), 100);
  error(() => l.earn('ann', 1000, 'a1'), 'DUPLICATE_PURCHASE');
});
