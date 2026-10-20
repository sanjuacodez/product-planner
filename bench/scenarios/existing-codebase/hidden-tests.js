// Hidden acceptance tests: copied into the workspace only after the agent has finished.
// "existing" tests check seeded behaviour documented in seed/README.md that must not regress;
// the rest check the capabilities and the modified behaviour stated in prompt.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { createInvoice, addLine, totals, finalize, duplicateInvoice, formatTotal, removeLine, summarizeByCurrency, InvoiceError } = await import(pathToFileURL(process.env.BENCH_TARGET || path.resolve('src/invoice.js')));
const error = (fn, code) => assert.throws(fn, (e) => e instanceof InvoiceError && e instanceof Error && e.code === code);
const draft = (number = 'INV-1', currency = 'USD') => createInvoice({ number, currency });
const item = (unitPrice, extra = {}) => ({ description: 'Item', quantity: 1, unitPrice, ...extra });
const withLines = (inv, ...lines) => lines.reduce(addLine, inv);

test('existing: createInvoice defaults to an empty USD draft and validates number and currency', () => {
  const inv = createInvoice({ number: 'INV-1' });
  assert.equal(inv.number, 'INV-1'); assert.equal(inv.currency, 'USD'); assert.equal(inv.status, 'draft'); assert.deepEqual(inv.lines, []);
  error(() => createInvoice({ number: '' }), 'INV_INVALID_NUMBER');
  error(() => createInvoice({ number: 'INV-1', currency: 'JPY' }), 'INV_INVALID_CURRENCY');
});
test('existing: addLine returns a new invoice and never mutates its input', () => {
  const empty = draft(); const one = addLine(empty, { description: 'Design', quantity: 2, unitPrice: 5000 });
  assert.notEqual(one, empty); assert.equal(empty.lines.length, 0); assert.equal(one.lines.length, 1);
  const two = addLine(one, item(10)); assert.equal(one.lines.length, 1); assert.equal(two.lines.length, 2);
  assert.equal(one.lines[0].description, 'Design'); assert.equal(one.lines[0].quantity, 2); assert.equal(one.lines[0].unitPrice, 5000); assert.equal(one.lines[0].taxRate, 0);
});
test('existing: invalid line fields throw INV_INVALID_LINE', () => {
  for (const bad of [{ description: '' }, { quantity: 0 }, { quantity: 1.5 }, { unitPrice: -1 }, { unitPrice: 9.99 }, { taxRate: 10001 }, { taxRate: -5 }]) error(() => addLine(draft(), { ...item(100), ...bad }), 'INV_INVALID_LINE');
});
test('existing: totals of undiscounted lines are unchanged', () => {
  const t = totals(withLines(draft(), { description: 'Design', quantity: 3, unitPrice: 1250, taxRate: 2000 }, { description: 'Hosting', quantity: 1, unitPrice: 999 }));
  assert.equal(t.subtotal, 4749); assert.equal(t.tax, 750); assert.equal(t.total, 5499);
});
test('existing: tax is rounded half up per line, not on the invoice total', () => {
  const two = totals(withLines(draft(), item(5, { taxRate: 1000 }), item(5, { taxRate: 1000 })));
  assert.equal(two.tax, 2); assert.equal(two.total, 12);
  assert.equal(totals(withLines(draft(), item(15, { taxRate: 1000 }))).tax, 2);
});
test('existing: finalize locks the invoice and keeps INV_EMPTY and INV_NOT_DRAFT', () => {
  const d = withLines(draft(), item(100)); const f = finalize(d);
  assert.equal(f.status, 'final'); assert.equal(d.status, 'draft');
  error(() => finalize(f), 'INV_NOT_DRAFT'); error(() => addLine(f, item(1)), 'INV_NOT_DRAFT'); error(() => finalize(draft()), 'INV_EMPTY');
});
test('existing: duplicateInvoice starts a new draft with copied lines', () => {
  const f = finalize(withLines(draft('INV-1', 'EUR'), { description: 'Work', quantity: 2, unitPrice: 300, taxRate: 500 }));
  const copy = duplicateInvoice(f, { number: 'INV-2' });
  assert.equal(copy.number, 'INV-2'); assert.equal(copy.status, 'draft'); assert.equal(copy.currency, 'EUR');
  assert.deepEqual(copy.lines, f.lines); assert.notEqual(copy.lines[0], f.lines[0]); assert.equal(f.status, 'final');
  error(() => duplicateInvoice(f, { number: ' ' }), 'INV_INVALID_NUMBER');
});
test('existing: formatTotal keeps the currency prefix and two decimals below 1000', () => {
  assert.equal(formatTotal(withLines(draft(), item(1230))), 'USD 12.30');
  assert.equal(formatTotal(withLines(draft('X', 'EUR'), item(5))), 'EUR 0.05');
  assert.equal(formatTotal(draft('X', 'GBP')), 'GBP 0.00');
  assert.equal(formatTotal(withLines(draft(), item(99999))), 'USD 999.99');
});

test('discount: taken off before tax, each rounded half up per line', () => {
  const t = totals(withLines(draft(), { description: 'A', quantity: 3, unitPrice: 1999, taxRate: 2000, discount: 1250 }, item(5, { discount: 1000, taxRate: 1250 })));
  // line 1: gross 5997, discount 749.625 -> 750, tax on 5247 at 20% = 1049.4 -> 1049; line 2: gross 5, discount 0.5 -> 1, tax on 4 at 12.5% = 0.5 -> 1
  assert.equal(t.subtotal, 6002); assert.equal(t.discount, 751); assert.equal(t.tax, 1050); assert.equal(t.total, 6002 - 751 + 1050);
});
test('discount: defaults to 0 and totals always report a discount field', () => {
  assert.equal(totals(draft()).discount, 0);
  const t = totals(withLines(draft(), item(1000, { taxRate: 2000 })));
  assert.equal(t.discount, 0); assert.equal(t.total, 1200);
  const free = totals(withLines(draft(), item(1000, { taxRate: 2000, discount: 10000 })));
  assert.equal(free.subtotal, 1000); assert.equal(free.discount, 1000); assert.equal(free.tax, 0); assert.equal(free.total, 0);
});
test('discount: an invalid discount throws INV_INVALID_LINE like other line fields', () => {
  for (const discount of [-1, 10001, 2.5, '10']) error(() => addLine(draft(), item(100, { discount })), 'INV_INVALID_LINE');
});
test('discount: line discounts survive finalize and duplicateInvoice', () => {
  const f = finalize(withLines(draft(), item(2000, { discount: 2500, taxRate: 1000 })));
  assert.equal(totals(f).total, 1650);
  assert.equal(totals(duplicateInvoice(f, { number: 'INV-2' })).total, 1650);
});
test('removeLine: removes the line at a zero-based index without mutating the input', () => {
  const inv = withLines(draft(), { description: 'A', quantity: 1, unitPrice: 100 }, { description: 'B', quantity: 1, unitPrice: 200 }, { description: 'C', quantity: 1, unitPrice: 300 });
  const out = removeLine(inv, 1);
  assert.deepEqual(out.lines.map((l) => l.description), ['A', 'C']); assert.equal(inv.lines.length, 3); assert.equal(out.status, 'draft'); assert.equal(totals(out).subtotal, 400);
  assert.equal(removeLine(removeLine(out, 0), 0).lines.length, 0);
});
test('removeLine: an index without a line throws INV_LINE_NOT_FOUND as an InvoiceError', () => {
  const inv = withLines(draft(), item(100), item(200));
  for (const index of [-1, 2, 1.5, '0', undefined]) error(() => removeLine(inv, index), 'INV_LINE_NOT_FOUND');
  error(() => removeLine(draft(), 0), 'INV_LINE_NOT_FOUND');
  assert.equal(inv.lines.length, 2);
});
test('removeLine: final invoices throw INV_NOT_DRAFT', () => { error(() => removeLine(finalize(withLines(draft(), item(100), item(200))), 0), 'INV_NOT_DRAFT'); });
test('summarizeByCurrency: counts and totals final invoices per currency, ignoring drafts', () => {
  const usd1 = finalize(withLines(draft('U1'), item(1000, { taxRate: 2000 })));
  const usd2 = finalize(withLines(draft('U2'), item(500)));
  const eur = finalize(withLines(draft('E1', 'EUR'), item(250)));
  const drafts = [withLines(draft('U3'), item(9999)), withLines(draft('G1', 'GBP'), item(100))];
  assert.deepEqual(summarizeByCurrency([usd1, ...drafts, eur, usd2]), { USD: { count: 2, total: 1700 }, EUR: { count: 1, total: 250 } });
  assert.deepEqual(summarizeByCurrency([]), {}); assert.deepEqual(summarizeByCurrency(drafts), {});
  assert.equal(usd1.status, 'final'); assert.equal(drafts[0].status, 'draft');
});
test('summarizeByCurrency: totals include line discounts and per-line tax rounding', () => {
  const a = finalize(withLines(draft('A', 'GBP'), item(5, { taxRate: 1000 }), item(5, { taxRate: 1000 })));
  const b = finalize(withLines(draft('B', 'GBP'), item(2000, { discount: 2500, taxRate: 1000 })));
  assert.deepEqual(summarizeByCurrency([a, b]), { GBP: { count: 2, total: 12 + 1650 } });
});
test('modified: formatTotal groups thousands with commas', () => {
  assert.equal(formatTotal(withLines(draft(), item(123456789))), 'USD 1,234,567.89');
  assert.equal(formatTotal(withLines(draft('X', 'EUR'), item(100000))), 'EUR 1,000.00');
  assert.equal(formatTotal(withLines(draft('X', 'GBP'), { description: 'Work', quantity: 2, unitPrice: 617280, taxRate: 0 })), 'GBP 12,345.60');
  assert.equal(formatTotal(withLines(draft(), item(100000000))), 'USD 1,000,000.00');
});
