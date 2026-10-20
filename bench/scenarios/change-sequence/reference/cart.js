export function createCart() {
  const lines = new Map(); // sku -> { unitPrice, quantity }; Map keeps insertion order, set() on an existing key keeps position
  let coupon = null;
  const LIMIT = 10, FREE_FROM = 5000, SHIPPING = 499;
  const COUPONS = { SAVE10: (s) => Math.floor(s / 10), FLAT500: (s) => Math.min(500, s), FREESHIP: () => 0 };
  const fail = (code) => { throw Object.assign(new Error(code), { code }); };
  const valid = (sku, q, price = 0) => { if (typeof sku !== 'string' || sku === '' || !Number.isInteger(q) || q <= 0 || !Number.isInteger(price) || price < 0) fail('INVALID_INPUT'); };
  const subtotal = () => { let s = 0; for (const l of lines.values()) s += l.unitPrice * l.quantity; return s; };
  const discount = () => (coupon ? COUPONS[coupon](subtotal()) : 0);
  const shipping = () => (lines.size === 0 || coupon === 'FREESHIP' || subtotal() - discount() >= FREE_FROM ? 0 : SHIPPING);
  return {
    addItem(sku, unitPrice, quantity) {
      valid(sku, quantity, unitPrice);
      const next = (lines.get(sku)?.quantity || 0) + quantity;
      if (next > LIMIT) fail('QUANTITY_LIMIT');
      lines.set(sku, { unitPrice, quantity: next });
      return next;
    },
    removeItem(sku, quantity) {
      valid(sku, quantity);
      const line = lines.get(sku);
      if (!line || quantity > line.quantity) fail('INVALID_REMOVE');
      const left = line.quantity - quantity;
      if (left === 0) lines.delete(sku); else lines.set(sku, { ...line, quantity: left });
      return left;
    },
    items: () => [...lines].map(([sku, l]) => ({ sku, unitPrice: l.unitPrice, quantity: l.quantity, lineTotal: l.unitPrice * l.quantity })),
    subtotal,
    applyCoupon(code) { if (!Object.hasOwn(COUPONS, code)) fail('UNKNOWN_COUPON'); coupon = code; },
    removeCoupon() { coupon = null; },
    discount,
    shipping,
    total: () => subtotal() - discount() + shipping(),
  };
}
