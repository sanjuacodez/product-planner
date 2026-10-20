# invoice-kit

Pure JavaScript functions for building, totalling and formatting invoices. ES modules, Node 20+, no runtime dependencies.

```js
import { createInvoice, addLine, finalize, totals, formatTotal } from './src/invoice.js';

let invoice = createInvoice({ number: 'INV-1001', currency: 'EUR' });
invoice = addLine(invoice, { description: 'Design', quantity: 3, unitPrice: 1250, taxRate: 2000 });
invoice = finalize(invoice);
totals(invoice);      // { subtotal: 3750, tax: 750, total: 4500 }
formatTotal(invoice); // 'EUR 45.00'
```

## API

All functions are exported from `src/invoice.js`.

| Function | Returns | Errors |
|---|---|---|
| `createInvoice({ number, currency = 'USD' })` | `{ number, currency, status: 'draft', lines: [] }` | `INV_INVALID_NUMBER` (number not a nonempty string), `INV_INVALID_CURRENCY` (not `USD`, `EUR` or `GBP`) |
| `addLine(invoice, { description, quantity, unitPrice, taxRate = 0 })` | a new invoice with the line appended | `INV_NOT_DRAFT`, `INV_INVALID_LINE` |
| `totals(invoice)` | `{ subtotal, tax, total }` in cents | none |
| `finalize(invoice)` | a new invoice with `status: 'final'` | `INV_NOT_DRAFT`, `INV_EMPTY` (no lines) |
| `duplicateInvoice(invoice, { number })` | a new draft with the same currency and copies of the lines (source may be draft or final) | `INV_INVALID_NUMBER` |
| `formatTotal(invoice)` | the total as `'<CUR> <units>.<cents>'`, e.g. `'USD 12.30'`, `'EUR 0.05'` | none |
| `InvoiceError` | the error class (re-exported from `src/errors.js`) | |

## Conventions

- **Money is integer cents; rates are integer basis points** (`2000` = 20%, valid range 0 to 10000). Never use floating-point amounts.
- **Rounding:** any rate applied to an amount is rounded half up to a whole cent with `applyRate` in `src/money.js` (5 cents at 10% gives 1 cent).
- **Tax is computed and rounded per line**, then summed. It is never computed on the invoice total: two 5-cent lines at 10% give 2 cents of tax, not 1.
- **Pure functions:** functions never mutate their arguments. Changes return a new invoice object; the original stays as it was.
- **Only drafts change:** any function that changes an invoice throws `INV_NOT_DRAFT` for a final invoice.
- **Validation:** every invalid field of a line (description, quantity, unitPrice, taxRate, or any field added later) throws `INV_INVALID_LINE`.
- **Errors:** always throw through `fail(code, message)` from `src/errors.js`, so every error is an `InvoiceError` (a subclass of `Error`) with a `code`. Codes are `UPPER_SNAKE_CASE` with an `INV_` prefix. Callers branch on `code`, never on the message.
- **Naming:** camelCase functions, named exports only (no default exports). New public functions are exported from `src/invoice.js`.

## Tests

`npm test` (runs `node --test`). Tests live in `test/*.test.js` and use `node:test` with `node:assert/strict`.
