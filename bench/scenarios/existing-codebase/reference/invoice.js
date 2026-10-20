// invoice-kit public API. Every function is pure: it never mutates its arguments
// and returns a new invoice object when something changes.
import { InvoiceError, fail } from './errors.js';
import { SUPPORTED_CURRENCIES, applyRate, formatCents, isBasisPoints } from './money.js';

export { InvoiceError };

function assertNumber(number) {
  if (typeof number !== 'string' || number.trim() === '') {
    fail('INV_INVALID_NUMBER', 'number must be a nonempty string');
  }
}

/**
 * Create an empty draft invoice.
 * @param {{ number: string, currency?: 'USD' | 'EUR' | 'GBP' }} options
 * @returns {{ number: string, currency: string, status: 'draft', lines: object[] }}
 */
export function createInvoice({ number, currency = 'USD' } = {}) {
  assertNumber(number);
  if (!SUPPORTED_CURRENCIES.includes(currency)) {
    fail('INV_INVALID_CURRENCY', `unsupported currency: ${currency}`);
  }
  return { number, currency, status: 'draft', lines: [] };
}

function assertDraft(invoice) {
  if (invoice.status !== 'draft') fail('INV_NOT_DRAFT', `invoice ${invoice.number} is ${invoice.status}`);
}

function validateLine({ description, quantity, unitPrice, taxRate, discount }) {
  if (typeof description !== 'string' || description.trim() === '') {
    fail('INV_INVALID_LINE', 'description must be a nonempty string');
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    fail('INV_INVALID_LINE', 'quantity must be a positive integer');
  }
  if (!Number.isInteger(unitPrice) || unitPrice < 0) {
    fail('INV_INVALID_LINE', 'unitPrice must be a nonnegative integer number of cents');
  }
  if (!isBasisPoints(taxRate)) {
    fail('INV_INVALID_LINE', 'taxRate must be an integer from 0 to 10000 basis points');
  }
  if (!isBasisPoints(discount)) {
    fail('INV_INVALID_LINE', 'discount must be an integer from 0 to 10000 basis points');
  }
}

/**
 * Return a copy of a draft invoice with one more line.
 * @param {object} invoice a draft invoice
 * @param {{ description: string, quantity: number, unitPrice: number, taxRate?: number, discount?: number }} line
 *   unitPrice in cents, taxRate and discount in basis points (default 0)
 */
export function addLine(invoice, { description, quantity, unitPrice, taxRate = 0, discount = 0 } = {}) {
  assertDraft(invoice);
  const line = { description, quantity, unitPrice, taxRate, discount };
  validateLine(line);
  return { ...invoice, lines: [...invoice.lines, line] };
}

/** Return a copy of a draft invoice without the line at a zero-based index. */
export function removeLine(invoice, index) {
  assertDraft(invoice);
  if (!Number.isInteger(index) || index < 0 || index >= invoice.lines.length) {
    fail('INV_LINE_NOT_FOUND', `no line at index ${index}`);
  }
  return { ...invoice, lines: invoice.lines.filter((_, i) => i !== index) };
}

/** Gross amount, discount and tax for one line. Discount and tax are rounded per line, never on the invoice total. */
function lineAmounts(line) {
  const gross = line.quantity * line.unitPrice;
  const discount = applyRate(gross, line.discount || 0);
  return { gross, discount, tax: applyRate(gross - discount, line.taxRate) };
}

/**
 * Invoice totals in cents.
 * @returns {{ subtotal: number, discount: number, tax: number, total: number }}
 */
export function totals(invoice) {
  let subtotal = 0;
  let discount = 0;
  let tax = 0;
  for (const line of invoice.lines) {
    const amounts = lineAmounts(line);
    subtotal += amounts.gross;
    discount += amounts.discount;
    tax += amounts.tax;
  }
  return { subtotal, discount, tax, total: subtotal - discount + tax };
}

/**
 * Return a final copy of a draft invoice. Final invoices can no longer change.
 * Throws INV_EMPTY for an invoice without lines.
 */
export function finalize(invoice) {
  assertDraft(invoice);
  if (invoice.lines.length === 0) fail('INV_EMPTY', 'cannot finalize an invoice without lines');
  return { ...invoice, status: 'final' };
}

/**
 * Start a new draft from any invoice (draft or final): same currency and lines, new number.
 * The source invoice is not changed and the copy shares no line objects with it.
 */
export function duplicateInvoice(invoice, { number } = {}) {
  assertNumber(number);
  return { number, currency: invoice.currency, status: 'draft', lines: invoice.lines.map((line) => ({ ...line })) };
}

/** Count and total of final invoices per currency; drafts are ignored. */
export function summarizeByCurrency(invoices) {
  const summary = {};
  for (const invoice of invoices) {
    if (invoice.status !== 'final') continue;
    const entry = summary[invoice.currency] || (summary[invoice.currency] = { count: 0, total: 0 });
    entry.count += 1;
    entry.total += totals(invoice).total;
  }
  return summary;
}

/** The invoice total formatted for display, for example "EUR 1,234.50". */
export function formatTotal(invoice) {
  return formatCents(totals(invoice).total, invoice.currency);
}
