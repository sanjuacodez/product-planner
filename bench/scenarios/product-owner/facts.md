# Product owner facts: café loyalty ledger

The scripted product owner answers questions using only these facts.

1. Earning rate: customers earn 1 base point per 10 rupees spent.
2. Base points are rounded down per purchase: base points = floor(amount / 10). For example, a 99 rupee purchase earns 9 base points and a 5 rupee purchase earns 0.
3. Welcome bonus: a customer's very first purchase earns 20 extra points on top of its normal points. The bonus is not multiplied by the tier multiplier. It is given only once per customer, ever, even if that first purchase is later refunded. earn() returns the total including the bonus.
4. Tier names are bronze, silver and gold (tier() returns them in lowercase). Every customer starts at bronze, including a customer the ledger has never seen.
5. Tier is decided by lifetime points, not by the current balance. Lifetime points are all points ever earned (including the welcome bonus) minus points removed by refunds. Redeeming points never lowers lifetime points or the tier.
6. Tier thresholds: silver at 500 lifetime points or more, gold at 1500 lifetime points or more.
7. Tier multipliers: bronze 1x, silver 1.5x, gold 2x. The multiplier is applied to the already rounded-down base points and the result is rounded down again: points = floor(floor(amount / 10) x multiplier). For example, a silver customer spending 95 rupees earns floor(9 x 1.5) = 13 points, not 14.
8. Tier upgrade timing: a purchase always earns points at the tier the customer had before that purchase. If a purchase takes the customer over a threshold, the new tier applies from the next purchase.
9. Redemption: points can be redeemed only in multiples of 100. Any other positive integer throws an Error with code REDEEM_STEP.
10. Redemption check order: the multiple-of-100 check comes before the balance check. For example, redeeming 150 points with a balance of 50 throws REDEEM_STEP, not INSUFFICIENT_POINTS.
11. Refunds remove exactly the points that purchase earned (including its welcome bonus, if it had one) from both the balance and the lifetime points. refund() returns the customer's new balance.
12. If the customer has already redeemed those points, the refund still succeeds and the balance goes negative; it is not clamped to 0 and no error is thrown. While the balance is too low, redeem throws INSUFFICIENT_POINTS as usual.
13. Because refunds reduce lifetime points, a refund can move a customer down a tier (for example from silver back to bronze).
14. Refunding a purchase that was already refunded throws ALREADY_REFUNDED. Refunding a purchaseId the ledger has never recorded throws UNKNOWN_PURCHASE. A refunded purchaseId still counts as used, so earn with it throws DUPLICATE_PURCHASE.
