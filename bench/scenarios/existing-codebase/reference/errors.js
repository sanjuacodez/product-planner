// Every error thrown by invoice-kit is an InvoiceError with a stable INV_* code.
// Callers branch on `error.code`; the message is for humans and may change.

export class InvoiceError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'InvoiceError';
    this.code = code;
  }
}

/** Throw an InvoiceError. Use this helper instead of `throw new Error(...)`. */
export function fail(code, message) {
  throw new InvoiceError(code, message);
}
