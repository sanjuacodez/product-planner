# existing-codebase

Measures whether a change to an existing product avoids regressions and follows its conventions. `seed/` is invoice-kit, a small library (`src/invoice.js`, `src/money.js`, `src/errors.js`, 9 passing tests, a README with conventions such as per-line half-up tax rounding, pure functions, `INV_*` codes on `InvoiceError`). It is copied into the workspace and committed before the agent starts.

`prompt.md` asks for line discounts, `removeLine`, `summarizeByCurrency`, and one modification: `formatTotal` groups thousands with commas. Some expected behaviour appears only in the seed README, not the prompt: an invalid discount throws `INV_INVALID_LINE`, and edits to a final invoice throw `INV_NOT_DRAFT`.

18 hidden tests: 8 existing (seeded behaviour that must not regress), 4 discount, 3 removeLine, 2 summarizeByCurrency and 1 modified (formatTotal). The seed alone passes the 8 existing tests and fails the other 10.

`reference/` holds the final `src/` modules (including the unchanged `errors.js`) so it can be imported on its own: `BENCH_TARGET=$PWD/bench/scenarios/existing-codebase/reference/invoice.js node --test bench/scenarios/existing-codebase/hidden-tests.js`
