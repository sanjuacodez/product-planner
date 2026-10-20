export function createInventory() {
  const available = new Map(), reserved = new Map();
  const fail = (code) => { throw Object.assign(new Error(code), { code }); };
  const valid = (sku, q) => { if (typeof sku !== 'string' || !sku.trim() || !Number.isInteger(q) || q <= 0) fail('INVALID_INPUT'); };
  return {
    stock: (sku) => available.get(sku) || 0,
    add(sku, q) { valid(sku, q); const next = (available.get(sku) || 0) + q; available.set(sku, next); return next; },
    reserve(sku, q) { valid(sku, q); const next = (available.get(sku) || 0) - q; if (next < 0) fail('INSUFFICIENT_STOCK'); available.set(sku, next); reserved.set(sku, (reserved.get(sku) || 0) + q); return next; },
    release(sku, q) { valid(sku, q); const next = (reserved.get(sku) || 0) - q; if (next < 0) fail('INVALID_RELEASE'); reserved.set(sku, next); const stock = (available.get(sku) || 0) + q; available.set(sku, stock); return stock; },
  };
}
