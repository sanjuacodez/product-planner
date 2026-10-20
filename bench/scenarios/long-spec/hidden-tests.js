// Hidden acceptance tests: copied into the workspace only after the agent has finished.
// One test per numbered rule in prompt.md; every test name starts with its rule number.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { createBoxOffice } = await import(pathToFileURL(process.env.BENCH_TARGET || path.resolve('tickets.js')));
const error = (fn, code) => assert.throws(fn, (e) => e instanceof Error && e.code === code);
const MIN = 60000, HOUR = 3600000, DAY = 86400000;
const T0 = Date.UTC(2026, 10, 2, 9, 0, 0);
function setup(opts = {}) {
  const clock = { t: T0 };
  const b = createBoxOffice({ now: () => clock.t, ...opts });
  return { b, clock };
}
const ev = (b, over = {}) => b.addEvent({ id: 'e1', name: 'Gig', capacity: 20, priceCents: 1000, startsAt: T0 + 10 * DAY, ...over });
const CODES = ['INVALID_OPTION', 'INVALID_EVENT', 'DUPLICATE_EVENT', 'UNKNOWN_EVENT', 'INVALID_CUSTOMER', 'INVALID_QUANTITY', 'SALES_CLOSED', 'SOLD_OUT', 'LIMIT_EXCEEDED', 'UNKNOWN_HOLD', 'HOLD_INACTIVE', 'HOLD_EXPIRED', 'UNKNOWN_ORDER', 'ALREADY_CANCELLED', 'EVENT_STARTED'];

test('R1: box offices are independent, including id counters', () => {
  const a = setup().b, c = setup().b;
  ev(a, { capacity: 5 }); ev(c, { capacity: 5 });
  assert.equal(a.hold('e1', 'x', 4).id, 'H1');
  assert.equal(c.hold('e1', 'x', 2).id, 'H1');
  assert.equal(a.available('e1'), 1);
  assert.equal(c.available('e1'), 3);
  assert.equal(a.confirm('H1').id, 'O1');
  assert.equal(c.confirm('H1').id, 'O1');
  assert.deepEqual(c.orders('x').map((o) => o.quantity), [2]);
});
test('R2: now defaults to Date.now and an injected clock is read every time', () => {
  const real = createBoxOffice();
  real.addEvent({ id: 'e1', name: 'Gig', capacity: 5, priceCents: 0, startsAt: Date.now() + DAY });
  const before = Date.now(), h = real.hold('e1', 'x', 1), after = Date.now();
  assert.ok(h.expiresAt >= before + 10 * MIN && h.expiresAt <= after + 10 * MIN);
  const { b, clock } = setup(); ev(b);
  assert.equal(b.hold('e1', 'x', 1).expiresAt, T0 + 10 * MIN);
  clock.t += 5 * MIN;
  assert.equal(b.hold('e1', 'y', 1).expiresAt, T0 + 15 * MIN);
});
test('R3: holdMinutes defaults to 10 and must be an integer from 1 to 60', () => {
  const d = createBoxOffice({ now: () => T0 }); ev(d);
  assert.equal(d.hold('e1', 'x', 1).expiresAt, T0 + 10 * MIN);
  assert.ok(createBoxOffice());
  for (const m of [1, 60]) { const { b } = setup({ holdMinutes: m }); ev(b); assert.equal(b.hold('e1', 'x', 1).expiresAt, T0 + m * MIN); }
  for (const m of [0, 61, 1.5, '10', null]) error(() => createBoxOffice({ now: () => T0, holdMinutes: m }), 'INVALID_OPTION');
});
test('R4: every error is an Error with a string code from the rules', () => {
  const { b } = setup(); ev(b);
  const calls = [() => b.addEvent({}), () => ev(b), () => b.available('zz'), () => b.hold('e1', '', 1), () => b.hold('e1', 'x', 0), () => b.confirm('H9'), () => b.cancelOrder('O9')];
  for (const fn of calls) {
    let caught;
    try { fn(); } catch (e) { caught = e; }
    assert.ok(caught instanceof Error);
    assert.equal(typeof caught.code, 'string');
    assert.ok(CODES.includes(caught.code), caught.code);
  }
});
test('R5: failed operations change nothing and use up no ids', () => {
  const { b, clock } = setup(); ev(b, { capacity: 3 });
  error(() => b.addEvent({ id: 'e2', name: 'Bad', capacity: 0, priceCents: 0, startsAt: T0 + DAY }), 'INVALID_EVENT');
  error(() => b.available('e2'), 'UNKNOWN_EVENT');
  error(() => b.hold('e1', 'x', 4), 'SOLD_OUT');
  error(() => b.hold('e1', 'x', 0), 'INVALID_QUANTITY');
  assert.equal(b.hold('e1', 'x', 1).id, 'H1');
  clock.t += 10 * MIN;
  error(() => b.confirm('H1'), 'HOLD_EXPIRED');
  const h = b.hold('e1', 'x', 2);
  assert.equal(h.id, 'H2');
  assert.equal(b.confirm(h.id).id, 'O1');
  assert.deepEqual(b.report('e1'), { capacity: 3, held: 0, sold: 2, available: 1, revenueCents: 2000 });
});
test('R6: addEvent stores the event and returns its fields', () => {
  const { b } = setup();
  assert.deepEqual(ev(b), { id: 'e1', name: 'Gig', capacity: 20, priceCents: 1000, startsAt: T0 + 10 * DAY });
  assert.equal(b.available('e1'), 20);
});
test('R7: event id and name must be non-empty strings after trimming', () => {
  const { b } = setup();
  for (const id of ['', '   ', 5, null]) error(() => ev(b, { id }), 'INVALID_EVENT');
  for (const name of ['', '  ', undefined, 7]) error(() => ev(b, { name }), 'INVALID_EVENT');
  ev(b, { id: 'ok', name: 'x' });
});
test('R8: capacity must be an integer from 1 to 10000', () => {
  const { b } = setup();
  for (const capacity of [0, 10001, 1.5, '10', -1]) error(() => ev(b, { capacity }), 'INVALID_EVENT');
  ev(b, { id: 'a', capacity: 1 });
  ev(b, { id: 'b', capacity: 10000 });
  assert.equal(b.available('a'), 1);
  assert.equal(b.available('b'), 10000);
});
test('R9: priceCents must be an integer of 0 or more; free events are allowed', () => {
  const { b } = setup();
  for (const priceCents of [-1, 1.5, '100', null]) error(() => ev(b, { priceCents }), 'INVALID_EVENT');
  ev(b, { priceCents: 0 });
  assert.equal(b.confirm(b.hold('e1', 'x', 2).id).totalCents, 0);
});
test('R10: startsAt must be an integer strictly later than now', () => {
  const { b } = setup();
  for (const startsAt of [T0, T0 - 1, T0 + DAY + 0.5, String(T0 + DAY)]) error(() => ev(b, { startsAt }), 'INVALID_EVENT');
  ev(b, { startsAt: T0 + 1 });
});
test('R11: a duplicate event id throws DUPLICATE_EVENT even with invalid fields and keeps the original', () => {
  const { b } = setup(); ev(b, { capacity: 7 });
  error(() => ev(b, { capacity: 50 }), 'DUPLICATE_EVENT');
  error(() => ev(b, { capacity: 0, name: '' }), 'DUPLICATE_EVENT');
  assert.equal(b.report('e1').capacity, 7);
});
test('R12: methods taking an eventId throw UNKNOWN_EVENT for unknown events', () => {
  const { b } = setup(); ev(b);
  error(() => b.hold('nope', 'x', 1), 'UNKNOWN_EVENT');
  error(() => b.available('nope'), 'UNKNOWN_EVENT');
  error(() => b.report('nope'), 'UNKNOWN_EVENT');
});
test('R13: hold returns id, eventId, customerId, quantity and expiresAt', () => {
  const { b } = setup(); ev(b);
  assert.deepEqual(b.hold('e1', 'c1', 2), { id: 'H1', eventId: 'e1', customerId: 'c1', quantity: 2, expiresAt: T0 + 10 * MIN });
  assert.equal(b.available('e1'), 18);
});
test('R14: customerId must be a non-empty string after trimming', () => {
  const { b } = setup(); ev(b);
  for (const c of ['', '   ', null, 3]) error(() => b.hold('e1', c, 1), 'INVALID_CUSTOMER');
  assert.equal(b.available('e1'), 20);
});
test('R15: quantity must be an integer from 1 to 8', () => {
  const { b } = setup(); ev(b);
  for (const q of [0, 9, 1.5, '2', -1]) error(() => b.hold('e1', 'x', q), 'INVALID_QUANTITY');
  assert.equal(b.hold('e1', 'a', 1).quantity, 1);
  assert.equal(b.hold('e1', 'b', 8).quantity, 8);
});
test('R16: hold ids are H1, H2, ... across all events', () => {
  const { b } = setup(); ev(b); ev(b, { id: 'e2' });
  assert.deepEqual([b.hold('e1', 'x', 1).id, b.hold('e2', 'x', 1).id, b.hold('e1', 'y', 1).id], ['H1', 'H2', 'H3']);
});
test('R17: expiresAt is the hold time plus holdMinutes', () => {
  const { b, clock } = setup({ holdMinutes: 25 }); ev(b);
  clock.t += 7 * MIN + 123;
  assert.equal(b.hold('e1', 'x', 1).expiresAt, T0 + 32 * MIN + 123);
});
test('R18: sales close 60 minutes before the event starts', () => {
  const { b, clock } = setup(); ev(b, { startsAt: T0 + 2 * HOUR });
  clock.t = T0 + HOUR - 1;
  assert.equal(b.hold('e1', 'x', 1).id, 'H1');
  clock.t = T0 + HOUR;
  error(() => b.hold('e1', 'y', 1), 'SALES_CLOSED');
  clock.t = T0 + 2 * HOUR + 1;
  error(() => b.hold('e1', 'y', 1), 'SALES_CLOSED');
});
test('R19: holding more than is available throws SOLD_OUT', () => {
  const { b } = setup(); ev(b, { capacity: 5 });
  b.hold('e1', 'a', 3);
  error(() => b.hold('e1', 'b', 3), 'SOLD_OUT');
  b.hold('e1', 'b', 2);
  assert.equal(b.available('e1'), 0);
  error(() => b.hold('e1', 'c', 1), 'SOLD_OUT');
});
test('R20: a customer may have at most 8 tickets per event across holds and confirmed orders', () => {
  const { b } = setup(); ev(b); ev(b, { id: 'e2' });
  b.confirm(b.hold('e1', 'c1', 5).id);
  b.hold('e1', 'c1', 3);
  error(() => b.hold('e1', 'c1', 1), 'LIMIT_EXCEEDED');
  assert.equal(b.hold('e2', 'c1', 8).quantity, 8);
  assert.equal(b.hold('e1', 'c2', 8).quantity, 8);
  assert.equal(b.available('e1'), 4);
});
test('R21: hold checks errors in the stated order', () => {
  const { b, clock } = setup({ holdMinutes: 60 });
  ev(b, { id: 'soon', capacity: 1, startsAt: T0 + 61 * MIN });
  ev(b, { id: 'full', capacity: 10 });
  b.hold('soon', 'other', 1);
  b.hold('full', 'c1', 8); b.hold('full', 'c2', 2);
  error(() => b.hold('nope', '', 0), 'UNKNOWN_EVENT');
  error(() => b.hold('full', '', 0), 'INVALID_CUSTOMER');
  clock.t = T0 + 2 * MIN;
  error(() => b.hold('soon', 'c1', 0), 'INVALID_QUANTITY');
  error(() => b.hold('soon', 'c1', 1), 'SALES_CLOSED');
  error(() => b.hold('full', 'c1', 1), 'SOLD_OUT');
});
test('R22: holds expire at expiresAt and stop counting without clean-up', () => {
  const { b, clock } = setup(); ev(b, { capacity: 10 });
  const h = b.hold('e1', 'c1', 8);
  clock.t = h.expiresAt - 1;
  assert.equal(b.available('e1'), 2);
  error(() => b.hold('e1', 'c1', 1), 'LIMIT_EXCEEDED');
  clock.t = h.expiresAt;
  assert.equal(b.available('e1'), 10);
  assert.equal(b.report('e1').held, 0);
  assert.equal(b.hold('e1', 'c1', 8).quantity, 8);
});
test('R23: confirm turns an active hold into a confirmed order', () => {
  const { b } = setup(); ev(b);
  const h = b.hold('e1', 'c1', 2);
  assert.deepEqual(b.confirm(h.id), { id: 'O1', eventId: 'e1', customerId: 'c1', quantity: 2, totalCents: 2000, status: 'confirmed' });
  const r = b.report('e1');
  assert.equal(r.held, 0); assert.equal(r.sold, 2); assert.equal(r.available, 18);
});
test('R24: order ids are O1, O2, ... in confirmation order across events', () => {
  const { b } = setup(); ev(b); ev(b, { id: 'e2' });
  const h1 = b.hold('e1', 'x', 1), h2 = b.hold('e2', 'x', 1), h3 = b.hold('e1', 'y', 1);
  assert.deepEqual([b.confirm(h2.id).id, b.confirm(h1.id).id, b.confirm(h3.id).id], ['O1', 'O2', 'O3']);
});
test('R25: 6 or more tickets get a 10% discount rounded down to a cent', () => {
  const { b } = setup(); ev(b, { priceCents: 1999 });
  assert.equal(b.confirm(b.hold('e1', 'a', 5).id).totalCents, 9995);
  assert.equal(b.confirm(b.hold('e1', 'b', 6).id).totalCents, 10794);
  assert.equal(b.confirm(b.hold('e1', 'c', 8).id).totalCents, 14392);
});
test('R26: an active hold can be confirmed after sales close', () => {
  const { b, clock } = setup({ holdMinutes: 30 }); ev(b, { startsAt: T0 + 2 * HOUR });
  clock.t = T0 + 50 * MIN;
  const h = b.hold('e1', 'x', 2);
  clock.t = T0 + 70 * MIN;
  error(() => b.hold('e1', 'y', 1), 'SALES_CLOSED');
  assert.equal(b.confirm(h.id).status, 'confirmed');
});
test('R27: releaseHold frees the tickets and returns the new available count', () => {
  const { b } = setup(); ev(b, { capacity: 10 });
  const h = b.hold('e1', 'x', 3); b.hold('e1', 'y', 2);
  assert.equal(b.releaseHold(h.id), 8);
  assert.equal(b.available('e1'), 8);
  assert.equal(b.report('e1').held, 2);
});
test('R28: unknown hold ids throw UNKNOWN_HOLD', () => {
  const { b } = setup(); ev(b);
  error(() => b.confirm('H1'), 'UNKNOWN_HOLD');
  error(() => b.releaseHold('nope'), 'UNKNOWN_HOLD');
});
test('R29: confirmed or released holds throw HOLD_INACTIVE, even after expiry time', () => {
  const { b, clock } = setup(); ev(b);
  const c = b.hold('e1', 'x', 1), r = b.hold('e1', 'y', 1);
  b.confirm(c.id); b.releaseHold(r.id);
  for (const id of [c.id, r.id]) { error(() => b.confirm(id), 'HOLD_INACTIVE'); error(() => b.releaseHold(id), 'HOLD_INACTIVE'); }
  clock.t += 11 * MIN;
  for (const id of [c.id, r.id]) { error(() => b.confirm(id), 'HOLD_INACTIVE'); error(() => b.releaseHold(id), 'HOLD_INACTIVE'); }
  assert.equal(b.report('e1').sold, 1);
});
test('R30: holds that expired while active throw HOLD_EXPIRED', () => {
  const { b, clock } = setup(); ev(b);
  const early = b.hold('e1', 'x', 1);
  clock.t = early.expiresAt - 1;
  assert.equal(b.confirm(early.id).id, 'O1');
  const h = b.hold('e1', 'y', 2);
  clock.t = h.expiresAt;
  error(() => b.confirm(h.id), 'HOLD_EXPIRED');
  error(() => b.releaseHold(h.id), 'HOLD_EXPIRED');
  assert.equal(b.available('e1'), 19);
});
test('R31: cancelOrder returns the order cancelled with refundCents', () => {
  const { b } = setup(); ev(b);
  const o = b.confirm(b.hold('e1', 'c1', 2).id);
  assert.deepEqual(b.cancelOrder(o.id), { ...o, status: 'cancelled', refundCents: 2000 });
});
test('R32: full refund more than 48 hours before start, otherwise half rounded down', () => {
  const { b, clock } = setup(); ev(b, { priceCents: 999 });
  const start = T0 + 10 * DAY;
  const o1 = b.confirm(b.hold('e1', 'a', 1).id), o2 = b.confirm(b.hold('e1', 'b', 1).id), o3 = b.confirm(b.hold('e1', 'c', 3).id);
  clock.t = start - 48 * HOUR - 1;
  assert.equal(b.cancelOrder(o1.id).refundCents, 999);
  clock.t = start - 48 * HOUR;
  assert.equal(b.cancelOrder(o2.id).refundCents, 499);
  clock.t = start - 1;
  assert.equal(b.cancelOrder(o3.id).refundCents, 1498);
});
test('R33: orders cannot be cancelled once the event has started', () => {
  const { b, clock } = setup(); ev(b);
  const o = b.confirm(b.hold('e1', 'c1', 2).id);
  clock.t = T0 + 10 * DAY;
  error(() => b.cancelOrder(o.id), 'EVENT_STARTED');
  assert.equal(b.orders('c1')[0].status, 'confirmed');
  assert.equal(b.report('e1').sold, 2);
});
test('R34: UNKNOWN_ORDER and ALREADY_CANCELLED, checked before EVENT_STARTED', () => {
  const { b, clock } = setup(); ev(b);
  const o = b.confirm(b.hold('e1', 'c1', 2).id);
  error(() => b.cancelOrder('O99'), 'UNKNOWN_ORDER');
  b.cancelOrder(o.id);
  error(() => b.cancelOrder(o.id), 'ALREADY_CANCELLED');
  clock.t = T0 + 11 * DAY;
  error(() => b.cancelOrder(o.id), 'ALREADY_CANCELLED');
  error(() => b.cancelOrder('nope'), 'UNKNOWN_ORDER');
});
test('R35: cancelled tickets return to availability and the customer limit', () => {
  const { b } = setup(); ev(b, { capacity: 10 });
  const o = b.confirm(b.hold('e1', 'c1', 8).id);
  error(() => b.hold('e1', 'c1', 1), 'LIMIT_EXCEEDED');
  b.cancelOrder(o.id);
  assert.equal(b.available('e1'), 10);
  assert.equal(b.hold('e1', 'c1', 8).quantity, 8);
  assert.equal(b.available('e1'), 2);
});
test('R36: orders lists a customer\'s orders across events by order number', () => {
  const { b } = setup(); ev(b, { capacity: 100 }); ev(b, { id: 'e2', capacity: 100 });
  const mine = [];
  for (let i = 0; i < 11; i++) {
    const eventId = i < 8 ? 'e1' : 'e2';
    b.confirm(b.hold(eventId, 'other', 1).id);
    mine.push(b.confirm(b.hold(eventId, 'c1', 1).id).id);
  }
  b.cancelOrder(mine[1]);
  const list = b.orders('c1');
  assert.deepEqual(list.map((o) => o.id), mine);
  assert.ok(mine.includes('O10') && mine.includes('O12'));
  assert.equal(list[1].status, 'cancelled');
  assert.equal(list[1].refundCents, 1000);
  assert.equal(list[10].eventId, 'e2');
  assert.deepEqual(b.orders('nobody'), []);
});
test('R37: available is capacity minus held minus sold', () => {
  const { b } = setup(); ev(b, { capacity: 10 });
  b.hold('e1', 'a', 2);
  b.confirm(b.hold('e1', 'b', 3).id);
  assert.equal(b.available('e1'), 5);
});
test('R38: report counts active holds and confirmed, not cancelled, orders', () => {
  const { b, clock } = setup(); ev(b, { capacity: 10 });
  b.hold('e1', 'gone', 1);
  clock.t += 5 * MIN;
  b.hold('e1', 'a', 2);
  b.confirm(b.hold('e1', 'b', 3).id);
  const c = b.confirm(b.hold('e1', 'c', 1).id);
  b.cancelOrder(c.id);
  clock.t += 6 * MIN; // first hold expired, second still active
  assert.deepEqual(b.report('e1'), { capacity: 10, held: 2, sold: 3, available: 5, revenueCents: 3000 });
});
test('R39: revenue keeps the unrefunded part of cancelled orders', () => {
  const { b, clock } = setup(); ev(b);
  b.confirm(b.hold('e1', 'a', 2).id);
  const late = b.confirm(b.hold('e1', 'b', 3).id), early = b.confirm(b.hold('e1', 'c', 1).id);
  b.cancelOrder(early.id);
  clock.t = T0 + 9 * DAY;
  b.cancelOrder(late.id);
  assert.equal(b.report('e1').revenueCents, 2000 + 1500);
});
test('R40: returned objects and arrays are copies', () => {
  const { b } = setup();
  const e = ev(b, { capacity: 10 }); e.capacity = 99;
  const h = b.hold('e1', 'c1', 2); h.quantity = 9; h.expiresAt = 0;
  const o = b.confirm(h.id); o.status = 'cancelled'; o.quantity = 9; o.totalCents = 1;
  const list = b.orders('c1'); list[0].status = 'cancelled'; list.push({ id: 'O9' });
  const r = b.report('e1'); r.sold = 50;
  assert.deepEqual(b.report('e1'), { capacity: 10, held: 0, sold: 2, available: 8, revenueCents: 2000 });
  assert.deepEqual(b.orders('c1'), [{ id: 'O1', eventId: 'e1', customerId: 'c1', quantity: 2, totalCents: 2000, status: 'confirmed' }]);
});
