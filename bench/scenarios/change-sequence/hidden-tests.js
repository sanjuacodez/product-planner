// Hidden acceptance tests: copied into the workspace only after the agent has finished.
// They check the FINAL state after every change in changes.json, using only behaviour stated in prompt.md and changes.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { createCart } = await import(pathToFileURL(process.env.BENCH_TARGET || path.resolve('cart.js')));
const error = (fn, code) => assert.throws(fn, (e) => e instanceof Error && e.code === code);
const line = (sku, unitPrice, quantity) => ({ sku, unitPrice, quantity, lineTotal: unitPrice * quantity });

test('base: empty cart has no items and zero amounts', () => { const c = createCart(); assert.deepEqual(c.items(), []); assert.equal(c.subtotal(), 0); assert.equal(c.discount(), 0); assert.equal(c.total(), 0); });
test('base: addItem accumulates the same SKU and returns the line quantity', () => { const c = createCart(); assert.equal(c.addItem('a', 250, 2), 2); assert.equal(c.addItem('a', 250, 3), 5); assert.deepEqual(c.items(), [line('a', 250, 5)]); });
test('base: items keep insertion order and subtotal sums line totals', () => { const c = createCart(); c.addItem('b', 300, 2); c.addItem('a', 125, 4); c.addItem('c', 0, 1); c.addItem('b', 300, 1); assert.deepEqual(c.items(), [line('b', 300, 3), line('a', 125, 4), line('c', 0, 1)]); assert.equal(c.subtotal(), 1400); });
test('base: invalid input throws INVALID_INPUT and changes nothing', () => {
  const c = createCart(); c.addItem('a', 100, 2);
  for (const args of [['', 100, 1], [null, 100, 1], ['x', -1, 1], ['x', 1.5, 1], ['x', '100', 1], ['x', 100, 0], ['x', 100, -1], ['x', 100, 1.5]]) error(() => c.addItem(...args), 'INVALID_INPUT');
  for (const args of [['', 1], [null, 1], ['a', 0], ['a', -1], ['a', 1.5]]) error(() => c.removeItem(...args), 'INVALID_INPUT');
  assert.deepEqual(c.items(), [line('a', 100, 2)]);
});
test('base: removeItem reduces quantity and drops a line that reaches zero', () => { const c = createCart(); c.addItem('a', 100, 3); c.addItem('b', 50, 1); assert.equal(c.removeItem('a', 2), 1); assert.equal(c.removeItem('a', 1), 0); assert.deepEqual(c.items(), [line('b', 50, 1)]); assert.equal(c.subtotal(), 50); });
test('base: invalid removals throw INVALID_REMOVE and change nothing', () => { const c = createCart(); c.addItem('a', 100, 2); error(() => c.removeItem('missing', 1), 'INVALID_REMOVE'); error(() => c.removeItem('a', 3), 'INVALID_REMOVE'); assert.deepEqual(c.items(), [line('a', 100, 2)]); });
test('base: items returns copies that cannot change the cart', () => { const c = createCart(); c.addItem('a', 100, 2); const got = c.items(); got[0].quantity = 99; got[0].unitPrice = 1; got.push(line('z', 1, 1)); assert.deepEqual(c.items(), [line('a', 100, 2)]); assert.equal(c.subtotal(), 200); });
test('base: SAVE10 rounds down, FLAT500 is capped, both follow the current subtotal', () => {
  const c = createCart(); c.addItem('a', 1999, 1); c.applyCoupon('SAVE10'); assert.equal(c.discount(), 199);
  c.addItem('b', 1000, 1); assert.equal(c.discount(), 299);
  const d = createCart(); d.addItem('a', 300, 1); d.applyCoupon('FLAT500'); assert.equal(d.discount(), 300); d.addItem('b', 400, 1); assert.equal(d.discount(), 500);
});
test('base: one coupon at a time and an unknown code keeps the previous coupon', () => { const c = createCart(); c.addItem('a', 10000, 1); c.applyCoupon('SAVE10'); assert.equal(c.discount(), 1000); c.applyCoupon('FLAT500'); assert.equal(c.discount(), 500); error(() => c.applyCoupon('BOGUS'), 'UNKNOWN_COUPON'); assert.equal(c.discount(), 500); });
test('base: carts are independent', () => { const a = createCart(), b = createCart(); a.addItem('x', 100, 1); a.applyCoupon('FLAT500'); assert.deepEqual(b.items(), []); assert.equal(b.discount(), 0); b.addItem('x', 200, 1); assert.deepEqual(a.items(), [line('x', 100, 1)]); });

test('change 1 (shipping): 499 below 5000 cents, free from 5000, included in total', () => { const c = createCart(); c.addItem('a', 4999, 1); assert.equal(c.shipping(), 499); assert.equal(c.total(), 5498); c.addItem('b', 1, 1); assert.equal(c.shipping(), 0); assert.equal(c.total(), 5000); });
test('change 1 (shipping): the threshold uses the discounted subtotal', () => { const c = createCart(); c.addItem('a', 5000, 1); c.applyCoupon('SAVE10'); assert.equal(c.shipping(), 499); assert.equal(c.total(), 4999); const d = createCart(); d.addItem('a', 5500, 1); d.applyCoupon('FLAT500'); assert.equal(d.shipping(), 0); assert.equal(d.total(), 5000); });
test('change 1 (shipping): an empty cart ships free, also after removing everything', () => { const c = createCart(); assert.equal(c.shipping(), 0); c.addItem('a', 100, 1); c.applyCoupon('FLAT500'); c.removeItem('a', 1); assert.equal(c.shipping(), 0); assert.equal(c.total(), 0); });

test('change 2 (limit): a line holds at most 10 units; violations throw QUANTITY_LIMIT and change nothing', () => { const c = createCart(); assert.equal(c.addItem('a', 100, 10), 10); error(() => c.addItem('a', 100, 1), 'QUANTITY_LIMIT'); error(() => c.addItem('b', 100, 11), 'QUANTITY_LIMIT'); assert.deepEqual(c.items(), [line('a', 100, 10)]); error(() => c.addItem('x', -1, 11), 'INVALID_INPUT'); error(() => c.addItem('x', 100, 11.5), 'INVALID_INPUT'); });
test('change 2 (limit): the limit is per line and removals free capacity', () => { const c = createCart(); c.addItem('a', 100, 6); assert.equal(c.addItem('a', 100, 4), 10); assert.equal(c.removeItem('a', 3), 7); assert.equal(c.addItem('a', 100, 3), 10); assert.equal(c.addItem('b', 100, 10), 10); assert.equal(c.subtotal(), 2000); });

test('change 3 (reversal): a different unit price replaces the line price instead of throwing PRICE_MISMATCH', () => { const c = createCart(); c.addItem('a', 100, 2); c.addItem('b', 50, 1); assert.equal(c.addItem('a', 150, 3), 5); assert.deepEqual(c.items(), [line('a', 150, 5), line('b', 50, 1)]); assert.equal(c.subtotal(), 800); });
test('change 3 (reversal): a re-price above the quantity limit is rejected and keeps the old price', () => { const c = createCart(); c.addItem('a', 100, 8); error(() => c.addItem('a', 200, 3), 'QUANTITY_LIMIT'); assert.deepEqual(c.items(), [line('a', 100, 8)]); assert.equal(c.addItem('a', 200, 2), 10); assert.deepEqual(c.items(), [line('a', 200, 10)]); });

test('change 4 (FREESHIP): no discount and free shipping below the threshold', () => { const c = createCart(); c.addItem('a', 1000, 1); c.applyCoupon('FREESHIP'); assert.equal(c.discount(), 0); assert.equal(c.shipping(), 0); assert.equal(c.total(), 1000); });
test('change 4 (FREESHIP): follows the one-coupon rule in both directions', () => {
  const c = createCart(); c.addItem('a', 2000, 1);
  c.applyCoupon('SAVE10'); assert.equal(c.total(), 2000 - 200 + 499);
  c.applyCoupon('FREESHIP'); assert.equal(c.discount(), 0); assert.equal(c.total(), 2000);
  c.applyCoupon('FLAT500'); assert.equal(c.shipping(), 499); assert.equal(c.total(), 1999);
  c.applyCoupon('FREESHIP'); error(() => c.applyCoupon('NOPE'), 'UNKNOWN_COUPON'); assert.equal(c.shipping(), 0);
});
test('change 4 (removeCoupon): removes the active coupon and is safe without one', () => { const c = createCart(); c.removeCoupon(); c.addItem('a', 2000, 1); c.applyCoupon('FREESHIP'); c.removeCoupon(); assert.equal(c.shipping(), 499); assert.equal(c.total(), 2499); c.applyCoupon('SAVE10'); c.removeCoupon(); assert.equal(c.discount(), 0); c.removeCoupon(); assert.equal(c.total(), 2499); });
