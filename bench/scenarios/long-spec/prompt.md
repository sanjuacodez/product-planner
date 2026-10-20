I want the ticket inventory core for a small events venue. Make it a plain JavaScript ES module, no runtime dependencies, no UI or server. Every rule below matters and will be checked, so implement all of them exactly. Times are numbers of milliseconds since the Unix epoch; money is integer cents.

Setup and general rules
1. Create `tickets.js` exporting `createBoxOffice(options)`. Each call returns an independent box office: events, holds, orders and id counters are never shared between instances.
2. `options.now` is a function returning the current time in milliseconds; the default is `Date.now`. Call it every time the current time is needed; never cache it.
3. `options.holdMinutes` defaults to 10. It must be an integer from 1 to 60 inclusive; otherwise `createBoxOffice` throws code `INVALID_OPTION`. `options` itself may be omitted.
4. Every error is thrown as an `Error` instance with a string `code` property set to one of the codes named in these rules.
5. A failed operation changes nothing: no event, hold or order is created or modified, and no hold or order id is used up.

Events
6. `addEvent({ id, name, capacity, priceCents, startsAt })` stores an event and returns `{ id, name, capacity, priceCents, startsAt }`.
7. `id` and `name` must be strings that are non-empty after trimming; otherwise throw `INVALID_EVENT`.
8. `capacity` must be an integer from 1 to 10000 inclusive; otherwise throw `INVALID_EVENT`.
9. `priceCents` must be an integer of 0 or more (0 means a free event); otherwise throw `INVALID_EVENT`.
10. `startsAt` must be an integer strictly later than `now()`; otherwise throw `INVALID_EVENT`.
11. If `id` is valid and already used by an event, throw `DUPLICATE_EVENT`, even when other fields are invalid; the existing event is unchanged.
12. Every method that takes an `eventId` throws `UNKNOWN_EVENT` when no event has that id.

Holds
13. `hold(eventId, customerId, quantity)` reserves tickets and returns `{ id, eventId, customerId, quantity, expiresAt }`.
14. `customerId` must be a string that is non-empty after trimming; otherwise throw `INVALID_CUSTOMER`.
15. `quantity` must be an integer from 1 to 8 inclusive; otherwise throw `INVALID_QUANTITY`.
16. Hold ids are `"H1"`, `"H2"`, `"H3"`, ... numbered in the order holds are successfully created in that box office, across all events.
17. `expiresAt` is `now()` at the time of the hold plus `holdMinutes` × 60000.
18. Sales close 60 minutes before the event: when `now()` is greater than or equal to `startsAt − 3600000`, `hold` throws `SALES_CLOSED`.
19. If `quantity` is greater than the tickets currently available for the event, throw `SOLD_OUT`.
20. A customer may have at most 8 tickets per event, counting their active holds and their confirmed (not cancelled) orders for that event; a hold that would exceed this throws `LIMIT_EXCEEDED`. The limit is per event: tickets for other events do not count.
21. `hold` checks in this order and throws the first failure: `UNKNOWN_EVENT`, `INVALID_CUSTOMER`, `INVALID_QUANTITY`, `SALES_CLOSED`, `SOLD_OUT`, `LIMIT_EXCEEDED`.
22. A hold is expired when `now()` is greater than or equal to its `expiresAt`. Expired holds stop counting toward held tickets, availability and the customer limit at that moment, without any clean-up call.

Confirming and releasing holds
23. `confirm(holdId)` turns an active hold into an order and returns `{ id, eventId, customerId, quantity, totalCents, status: 'confirmed' }`. The hold stops being active.
24. Order ids are `"O1"`, `"O2"`, `"O3"`, ... numbered in the order orders are successfully created in that box office, across all events.
25. `totalCents` is `quantity × priceCents` for 1 to 5 tickets. For 6 or more tickets a 10% group discount applies: `totalCents` is 90% of `quantity × priceCents`, rounded down to a whole cent.
26. `confirm` does not check whether sales are closed: an active hold can still be confirmed after sales close.
27. `releaseHold(holdId)` ends an active hold, returns its tickets to availability and returns the event's new available count.
28. `confirm` and `releaseHold` throw `UNKNOWN_HOLD` for a hold id that was never created.
29. `confirm` and `releaseHold` throw `HOLD_INACTIVE` for a hold that was already confirmed or released, even if its expiry time has since passed.
30. `confirm` and `releaseHold` throw `HOLD_EXPIRED` for a hold that expired while still active (rule 22).

Orders
31. `cancelOrder(orderId)` cancels a confirmed order and returns the order with `status: 'cancelled'` and an added `refundCents`.
32. If `now()` is more than 48 hours (172800000 ms) before `startsAt`, `refundCents` equals `totalCents`; otherwise `refundCents` is half of `totalCents`, rounded down to a whole cent.
33. When `now()` is greater than or equal to `startsAt`, `cancelOrder` throws `EVENT_STARTED`.
34. `cancelOrder` throws `UNKNOWN_ORDER` for an order id that was never created and `ALREADY_CANCELLED` for an order that is already cancelled. The checks run in this order: `UNKNOWN_ORDER`, `ALREADY_CANCELLED`, `EVENT_STARTED`.
35. A cancelled order's tickets return to availability and stop counting toward the customer limit.
36. `orders(customerId)` returns all of that customer's orders across every event, confirmed and cancelled (cancelled ones include `refundCents`), sorted by order number ascending (so `O2` comes before `O10`). A customer with no orders gets `[]`.

Reporting
37. `available(eventId)` returns `capacity − held − sold`.
38. `report(eventId)` returns `{ capacity, held, sold, available, revenueCents }`, where `held` is the number of tickets in active holds and `sold` the number of tickets in confirmed, not cancelled, orders.
39. `revenueCents` is the sum of `totalCents` over confirmed orders plus, for each cancelled order, `totalCents − refundCents`.
40. Every returned object and array is a copy: changing it never changes the box office's state.

Build it, test it and document the public API. Use your recommendations for anything these rules do not cover. You are authorized to implement and verify the requested scope.
