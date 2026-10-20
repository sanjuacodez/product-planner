# Scenario: long-spec

Measures whether requirements survive a long, precise single request. `prompt.md` gives 40 numbered rules for one module, an event-ticket box office (`tickets.js`, `createBoxOffice(options)` with `addEvent`, `hold`, `confirm`, `releaseHold`, `cancelOrder`, `orders`, `available` and `report`). The rules mix input validation, exact error codes, inclusive and exclusive boundaries, error check order, atomicity (failed calls use up no ids), instance independence, rounding, and cross-cutting rules that interact (hold expiry against availability and the per-customer limit, sales closing against confirm, refunds against revenue).

40 hidden tests, one per rule, each named after its rule (`R17: ...`). All 40 are stated in `prompt.md`; there are no hidden facts. Time comes from an injected `options.now`, so the tests never wait.

Verify: `BENCH_TARGET=$PWD/bench/scenarios/long-spec/reference/tickets.js node --test bench/scenarios/long-spec/hidden-tests.js`
