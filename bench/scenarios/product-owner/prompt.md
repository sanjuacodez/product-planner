I run a café and want the core of a loyalty-points ledger for it. Make it a plain JavaScript ES module, no runtime dependencies, no UI or server. Put it in loyalty.js exporting createLedger(). Each call returns an independent in-memory ledger.

The ledger needs these methods:
- earn(customerId, amount, purchaseId): records a purchase of `amount` rupees by the customer and returns the points that purchase earned.
- redeem(customerId, points): spends points from the customer's balance and returns the new balance.
- refund(purchaseId): reverses a recorded purchase and returns that customer's new balance.
- balance(customerId): the customer's current points; 0 for a customer the ledger has never seen.
- tier(customerId): the customer's tier name as a lowercase string.

customerId and purchaseId must be non-empty strings, amount must be a positive finite number and points must be a positive integer; otherwise throw an Error with code INVALID_INPUT. A purchaseId can be recorded only once per ledger, for any customer: reusing one throws DUPLICATE_PURCHASE. Redeeming more points than the balance throws INSUFFICIENT_POINTS. Every error is an Error object with a `code` property, and a failed operation changes nothing.

Our shop has specific rules for loyalty points (how they are earned and redeemed), refunds and tier upgrades. Ask me about them before you decide; for anything else use your recommendations. Build it, test it and document the public API. You are authorized to implement and verify the requested scope.
