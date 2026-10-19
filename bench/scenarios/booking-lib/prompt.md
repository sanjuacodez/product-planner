I want to build the scheduling core for a tutoring app: tutors publish weekly availability and students book lessons. Start with a plain JavaScript library (no UI, no server, no database, no npm dependencies) so the rules are solid before we add anything else.

Create `booking.js` at the project root as an ES module exporting `createScheduler(options)`. All times are UTC and passed as ISO strings. Options (all optional): `now` (function returning the current Date; default real time), `minNoticeHours` (default 12), `horizonDays` (default 56), `cancelWindowHours` (default 24), `bufferMinutes` (default 0).

The scheduler needs these methods:
- `addTutor({ id, name })`
- `setWeeklyAvailability(tutorId, blocks)` where each block is `{ day, start, end }`: `day` is the UTC weekday (0 = Sunday) and `start`/`end` are "HH:MM" UTC. Replaces any previous availability.
- `blockDate(tutorId, 'YYYY-MM-DD')`: the tutor is unavailable that whole UTC day.
- `listSlots(tutorId, fromIso, toIso, durationMinutes)`: bookable start/end pairs `[{ start, end }]` (ISO strings) in that range, sorted by start.
- `book({ tutorId, studentId, start, durationMinutes })`: returns `{ id, tutorId, studentId, start, end, status: 'booked' }`.
- `cancel(bookingId, { by })` where `by` is 'student' or 'tutor': returns the booking with status 'cancelled'.
- `reschedule(bookingId, newStart, { by })`: moves the booking (same duration) and returns it.
- `upcoming(userId)`: booked (not cancelled) lessons where the user is the tutor or the student, starting at or after now, sorted by start.

Rules:
- Lessons last 30, 45 or 60 minutes and start on :00 or :30.
- A lesson must fit entirely inside one availability block and not on a blocked date.
- A tutor can't have overlapping lessons, and there must be at least `bufferMinutes` between the end of one lesson and the start of the next.
- Bookings must start at least `minNoticeHours` after now and no later than `horizonDays` after now.
- Students can't cancel or reschedule within `cancelWindowHours` of the lesson start; tutors can do both at any time.
- Cancelled lessons free their time again. Cancelling twice is an error.
- A failed reschedule must leave the original booking unchanged. A lesson may be rescheduled into time that overlaps its own current slot.
- Errors are thrown as `Error` objects with a `code` property: `UNKNOWN_TUTOR`, `UNKNOWN_BOOKING`, `INVALID_DURATION`, `INVALID_START`, `SLOT_UNAVAILABLE`, `TOO_SOON`, `TOO_FAR`, `CANCEL_WINDOW`, `ALREADY_CANCELLED`.

Please build it, test it well, and tell me when it's done.
