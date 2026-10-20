# Scenario: product-owner

Measures whether the agent asks the product owner before deciding rules only the owner knows. `prompt.md` builds a café loyalty-points ledger (`loyalty.js`, `createLedger()`) and says explicitly that the shop has its own rules for earning and redeeming points, refunds and tier upgrades, and that the agent should ask about them first.

`facts.md` holds the owner's 14 answers (earning rate, rounding, welcome bonus, tier names, thresholds and multipliers, upgrade timing, redemption step and check order, refund effects and error codes). A separate model answers the agent's questions using only that file.

17 hidden tests: 5 (`prompt:`) check behaviour stated in `prompt.md`, 12 check facts available only by asking. Several facts are deliberately hard to guess: rounding before and after the multiplier (silver, 95 rupees earns 13), the `REDEEM_STEP` code and its check before the balance, upgrades applying from the next purchase, and refunds driving the balance negative. An agent that guesses instead of asking should pass the prompt tests and fail most fact tests.

Verify: `BENCH_TARGET=$PWD/bench/scenarios/product-owner/reference/loyalty.js node --test bench/scenarios/product-owner/hidden-tests.js`
