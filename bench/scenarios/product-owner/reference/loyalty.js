const THRESHOLDS = [['gold', 1500, 2], ['silver', 500, 1.5], ['bronze', 0, 1]];
const WELCOME_BONUS = 20;

export function createLedger() {
  const customers = new Map(); // id -> { balance, lifetime, purchased }
  const purchases = new Map(); // purchaseId -> { customerId, points, refunded }
  const fail = (code) => { throw Object.assign(new Error(code), { code }); };
  const isId = (v) => typeof v === 'string' && v.trim() !== '';
  const get = (id) => customers.get(id) || { balance: 0, lifetime: 0, purchased: false };
  const tierOf = (lifetime) => THRESHOLDS.find(([, min]) => lifetime >= min);

  return {
    earn(customerId, amount, purchaseId) {
      if (!isId(customerId) || !isId(purchaseId) || typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) fail('INVALID_INPUT');
      if (purchases.has(purchaseId)) fail('DUPLICATE_PURCHASE');
      const c = { ...get(customerId) };
      const [, , multiplier] = tierOf(c.lifetime);
      let points = Math.floor(Math.floor(amount / 10) * multiplier);
      if (!c.purchased) { points += WELCOME_BONUS; c.purchased = true; }
      c.balance += points; c.lifetime += points;
      customers.set(customerId, c);
      purchases.set(purchaseId, { customerId, points, refunded: false });
      return points;
    },
    redeem(customerId, points) {
      if (!isId(customerId) || !Number.isInteger(points) || points <= 0) fail('INVALID_INPUT');
      if (points % 100 !== 0) fail('REDEEM_STEP');
      const c = get(customerId);
      if (points > c.balance) fail('INSUFFICIENT_POINTS');
      customers.set(customerId, { ...c, balance: c.balance - points });
      return c.balance - points;
    },
    refund(purchaseId) {
      if (!isId(purchaseId)) fail('INVALID_INPUT');
      const p = purchases.get(purchaseId);
      if (!p) fail('UNKNOWN_PURCHASE');
      if (p.refunded) fail('ALREADY_REFUNDED');
      const c = get(p.customerId);
      const next = { ...c, balance: c.balance - p.points, lifetime: c.lifetime - p.points };
      customers.set(p.customerId, next);
      p.refunded = true;
      return next.balance;
    },
    balance: (customerId) => get(customerId).balance,
    tier: (customerId) => tierOf(get(customerId).lifetime)[0],
  };
}
