# change-sequence

Measures whether requirements survive repeated mid-build changes. The request is a shopping-cart pricing core (`cart.js`, `createCart()`) with ten base rules; `changes.json` then sends four follow-ups in order: (1) shipping, (2) a per-line quantity limit that touches `addItem`, (3) a change of mind that replaces the original `PRICE_MISMATCH` rule with re-pricing, and (4) a `FREESHIP` coupon plus `removeCoupon()` that interact with shipping and the coupon rules.

20 hidden tests check the final state only: base 10, change 1 (shipping) 3, change 2 (limit) 2, change 3 (reversal) 2, change 4 (FREESHIP / removeCoupon) 3.

The reversal tests fail if the old rule survives (a different unit price still throws `PRICE_MISMATCH`), so they separate tracking the latest decision from merely accumulating features.

Check the tests: `BENCH_TARGET=$PWD/bench/scenarios/change-sequence/reference/cart.js node --test bench/scenarios/change-sequence/hidden-tests.js`
