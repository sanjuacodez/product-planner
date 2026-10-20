// Money helpers. Amounts are integer cents; rates are integer basis points (10000 = 100%).

export const SUPPORTED_CURRENCIES = Object.freeze(['USD', 'EUR', 'GBP']);

/** True for an integer rate from 0 to 10000 basis points. */
export function isBasisPoints(value) {
  return Number.isInteger(value) && value >= 0 && value <= 10000;
}

/**
 * The share of `cents` given by `basisPoints`, rounded half up to a whole cent.
 * Integer arithmetic only, so 5 cents at 10% is exactly 0.5 and rounds to 1.
 */
export function applyRate(cents, basisPoints) {
  return Math.floor((cents * basisPoints + 5000) / 10000);
}

/** Format nonnegative cents as "<CUR> <units>.<cents>" with comma thousands, for example "USD 1,234.30". */
export function formatCents(cents, currency) {
  const units = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const rest = String(cents % 100).padStart(2, '0');
  return `${currency} ${units}.${rest}`;
}
