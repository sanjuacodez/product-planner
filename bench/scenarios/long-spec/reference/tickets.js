const fail = (code) => { throw Object.assign(new Error(code), { code }); };
const isText = (v) => typeof v === 'string' && v.trim() !== '';
const HOUR = 3600000;

export function createBoxOffice(options = {}) {
  const now = options.now || Date.now;
  const holdMinutes = options.holdMinutes === undefined ? 10 : options.holdMinutes;
  if (!Number.isInteger(holdMinutes) || holdMinutes < 1 || holdMinutes > 60) fail('INVALID_OPTION');
  const events = new Map(), holds = new Map(), orders = new Map();
  let holdSeq = 0, orderSeq = 0;

  const event = (id) => events.get(id) || fail('UNKNOWN_EVENT');
  const holdActive = (h, t = now()) => h.state === 'active' && t < h.expiresAt;
  const tally = (eventId, customerId) => {
    const t = now();
    let held = 0, sold = 0;
    for (const h of holds.values()) if (h.eventId === eventId && holdActive(h, t) && (customerId === undefined || h.customerId === customerId)) held += h.quantity;
    for (const o of orders.values()) if (o.eventId === eventId && o.status === 'confirmed' && (customerId === undefined || o.customerId === customerId)) sold += o.quantity;
    return { held, sold };
  };
  const availableOf = (e) => { const { held, sold } = tally(e.id); return e.capacity - held - sold; };
  const publicHold = (h) => ({ id: h.id, eventId: h.eventId, customerId: h.customerId, quantity: h.quantity, expiresAt: h.expiresAt });
  const activeHold = (holdId) => {
    const h = holds.get(holdId);
    if (!h) fail('UNKNOWN_HOLD');
    if (h.state !== 'active') fail('HOLD_INACTIVE');
    if (now() >= h.expiresAt) fail('HOLD_EXPIRED');
    return h;
  };

  return {
    addEvent({ id, name, capacity, priceCents, startsAt } = {}) {
      if (!isText(id)) fail('INVALID_EVENT');
      if (events.has(id)) fail('DUPLICATE_EVENT');
      if (!isText(name) || !Number.isInteger(capacity) || capacity < 1 || capacity > 10000
        || !Number.isInteger(priceCents) || priceCents < 0 || !Number.isInteger(startsAt) || startsAt <= now()) fail('INVALID_EVENT');
      const e = { id, name, capacity, priceCents, startsAt };
      events.set(id, e);
      return { ...e };
    },
    hold(eventId, customerId, quantity) {
      const e = event(eventId);
      if (!isText(customerId)) fail('INVALID_CUSTOMER');
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 8) fail('INVALID_QUANTITY');
      const t = now();
      if (t >= e.startsAt - HOUR) fail('SALES_CLOSED');
      if (quantity > availableOf(e)) fail('SOLD_OUT');
      const mine = tally(eventId, customerId);
      if (mine.held + mine.sold + quantity > 8) fail('LIMIT_EXCEEDED');
      const h = { id: `H${++holdSeq}`, eventId, customerId, quantity, expiresAt: t + holdMinutes * 60000, state: 'active' };
      holds.set(h.id, h);
      return publicHold(h);
    },
    confirm(holdId) {
      const h = activeHold(holdId);
      const e = events.get(h.eventId);
      const gross = h.quantity * e.priceCents;
      const totalCents = h.quantity >= 6 ? Math.floor((gross * 9) / 10) : gross;
      const o = { id: `O${++orderSeq}`, eventId: h.eventId, customerId: h.customerId, quantity: h.quantity, totalCents, status: 'confirmed' };
      h.state = 'confirmed';
      orders.set(o.id, o);
      return { ...o };
    },
    releaseHold(holdId) {
      const h = activeHold(holdId);
      h.state = 'released';
      return availableOf(events.get(h.eventId));
    },
    cancelOrder(orderId) {
      const o = orders.get(orderId);
      if (!o) fail('UNKNOWN_ORDER');
      if (o.status === 'cancelled') fail('ALREADY_CANCELLED');
      const e = events.get(o.eventId), t = now();
      if (t >= e.startsAt) fail('EVENT_STARTED');
      o.refundCents = e.startsAt - t > 48 * HOUR ? o.totalCents : Math.floor(o.totalCents / 2);
      o.status = 'cancelled';
      return { ...o };
    },
    orders(customerId) {
      return [...orders.values()].filter((o) => o.customerId === customerId)
        .sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1))).map((o) => ({ ...o }));
    },
    available: (eventId) => availableOf(event(eventId)),
    report(eventId) {
      const e = event(eventId);
      const { held, sold } = tally(eventId);
      let revenueCents = 0;
      for (const o of orders.values()) if (o.eventId === eventId) revenueCents += o.status === 'confirmed' ? o.totalCents : o.totalCents - o.refundCents;
      return { capacity: e.capacity, held, sold, available: e.capacity - held - sold, revenueCents };
    },
  };
}
