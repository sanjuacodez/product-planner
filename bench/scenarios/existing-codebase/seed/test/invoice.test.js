import test from 'node:test';
import assert from 'node:assert/strict';
import { createInvoice, addLine, totals, finalize, duplicateInvoice, formatTotal, InvoiceError } from '../src/invoice.js';

const rejects = (fn, code) => assert.throws(fn, (e) => e instanceof InvoiceError && e.code === code);

test('createInvoice returns an empty USD draft by default', () => {
  assert.deepEqual(createInvoice({ number: 'INV-1' }), { number: 'INV-1', currency: 'USD', status: 'draft', lines: [] });
  assert.equal(createInvoice({ number: 'INV-2', currency: 'GBP' }).currency, 'GBP');
});

test('createInvoice validates number and currency', () => {
  rejects(() => createInvoice({ number: '' }), 'INV_INVALID_NUMBER');
  rejects(() => createInvoice(), 'INV_INVALID_NUMBER');
  rejects(() => createInvoice({ number: 'INV-1', currency: 'JPY' }), 'INV_INVALID_CURRENCY');
});

test('addLine returns a new invoice and leaves the original untouched', () => {
  const empty = createInvoice({ number: 'INV-1' });
  const one = addLine(empty, { description: 'Design', quantity: 2, unitPrice: 5000 });
  assert.notEqual(one, empty);
  assert.equal(empty.lines.length, 0);
  assert.equal(one.lines.length, 1);
  assert.equal(one.lines[0].taxRate, 0);
});

test('addLine rejects invalid lines with INV_INVALID_LINE', () => {
  const inv = createInvoice({ number: 'INV-1' });
  const ok = { description: 'Work', quantity: 1, unitPrice: 100, taxRate: 0 };
  for (const bad of [{ description: '' }, { quantity: 0 }, { quantity: 1.5 }, { unitPrice: -1 }, { unitPrice: 9.99 }, { taxRate: 10001 }, { taxRate: -5 }]) {
    rejects(() => addLine(inv, { ...ok, ...bad }), 'INV_INVALID_LINE');
  }
});

test('totals sums line amounts and per-line tax', () => {
  let inv = createInvoice({ number: 'INV-1' });
  inv = addLine(inv, { description: 'Design', quantity: 3, unitPrice: 1250, taxRate: 2000 });
  inv = addLine(inv, { description: 'Hosting', quantity: 1, unitPrice: 999 });
  const t = totals(inv);
  assert.equal(t.subtotal, 4749);
  assert.equal(t.tax, 750);
  assert.equal(t.total, 5499);
});

test('tax is rounded half up on each line, not on the invoice total', () => {
  let inv = createInvoice({ number: 'INV-1' });
  inv = addLine(inv, { description: 'A', quantity: 1, unitPrice: 5, taxRate: 1000 });
  inv = addLine(inv, { description: 'B', quantity: 1, unitPrice: 5, taxRate: 1000 });
  assert.equal(totals(inv).tax, 2);
});

test('finalize locks the invoice', () => {
  const draft = addLine(createInvoice({ number: 'INV-1' }), { description: 'Work', quantity: 1, unitPrice: 100 });
  const final = finalize(draft);
  assert.equal(final.status, 'final');
  assert.equal(draft.status, 'draft');
  rejects(() => finalize(final), 'INV_NOT_DRAFT');
  rejects(() => addLine(final, { description: 'More', quantity: 1, unitPrice: 1 }), 'INV_NOT_DRAFT');
  rejects(() => finalize(createInvoice({ number: 'INV-2' })), 'INV_EMPTY');
});

test('duplicateInvoice starts a new draft with copied lines', () => {
  const final = finalize(addLine(createInvoice({ number: 'INV-1', currency: 'EUR' }), { description: 'Work', quantity: 2, unitPrice: 300, taxRate: 500 }));
  const copy = duplicateInvoice(final, { number: 'INV-2' });
  assert.equal(copy.status, 'draft');
  assert.equal(copy.currency, 'EUR');
  assert.deepEqual(copy.lines, final.lines);
  assert.notEqual(copy.lines[0], final.lines[0]);
  assert.equal(final.status, 'final');
  rejects(() => duplicateInvoice(final, { number: ' ' }), 'INV_INVALID_NUMBER');
});

test('formatTotal prints the currency code and two decimals', () => {
  const inv = (unitPrice, currency) => addLine(createInvoice({ number: 'X', currency }), { description: 'Item', quantity: 1, unitPrice });
  assert.equal(formatTotal(inv(1230, 'USD')), 'USD 12.30');
  assert.equal(formatTotal(inv(5, 'EUR')), 'EUR 0.05');
  assert.equal(formatTotal(createInvoice({ number: 'X', currency: 'GBP' })), 'GBP 0.00');
});
