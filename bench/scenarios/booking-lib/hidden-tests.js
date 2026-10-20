// Hidden acceptance tests: copied into the workspace only after the agent has finished.
// They check only behaviour stated explicitly in prompt.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const target = process.env.BENCH_TARGET || path.join(process.cwd(), 'booking.js');
const { createScheduler } = await import(pathToFileURL(target).href);
const NOW = new Date('2026-11-01T12:00:00Z'); // Sunday
const MON = '2026-11-02', TUE = '2026-11-03';
const at = (day, hhmm) => `${day}T${hhmm}:00.000Z`;
const same = (a, b) => Date.parse(a) === Date.parse(b);
function setup(opts = {}) {
  const s = createScheduler({ now: () => NOW, ...opts });
  s.addTutor({ id: 'tutor', name: 'Ada' });
  s.setWeeklyAvailability('tutor', [{ day: 1, start: '09:00', end: '12:00' }, { day: 2, start: '14:00', end: '16:00' }]);
  return s;
}
const code = (c) => (e) => e?.code === c;

test('listSlots returns aligned slots that fit inside availability', () => {
  const slots = setup().listSlots('tutor', at(MON, '00:00'), at(MON, '23:59'), 60);
  assert.deepEqual(slots.map((x) => new Date(x.start).toISOString().slice(11, 16)), ['09:00', '09:30', '10:00', '10:30', '11:00']);
  assert.ok(same(slots[0].end, at(MON, '10:00')));
});
test('a lesson ending exactly at the end of a block is allowed', () => {
  const b = setup().book({ tutorId: 'tutor', studentId: 's1', start: at(MON, '11:00'), durationMinutes: 60 });
  assert.equal(b.status, 'booked'); assert.ok(same(b.end, at(MON, '12:00'))); assert.ok(b.id);
});
test('blocked dates have no slots and cannot be booked', () => {
  const s = setup(); s.blockDate('tutor', MON);
  assert.equal(s.listSlots('tutor', at(MON, '00:00'), at(MON, '23:59'), 30).length, 0);
  assert.throws(() => s.book({ tutorId: 'tutor', studentId: 's1', start: at(MON, '09:00'), durationMinutes: 30 }), code('SLOT_UNAVAILABLE'));
});
test('double and overlapping bookings are rejected', () => {
  const s = setup(); s.book({ tutorId: 'tutor', studentId: 's1', start: at(MON, '10:00'), durationMinutes: 60 });
  assert.throws(() => s.book({ tutorId: 'tutor', studentId: 's2', start: at(MON, '10:00'), durationMinutes: 30 }), code('SLOT_UNAVAILABLE'));
  assert.throws(() => s.book({ tutorId: 'tutor', studentId: 's2', start: at(MON, '10:30'), durationMinutes: 60 }), code('SLOT_UNAVAILABLE'));
  assert.throws(() => s.book({ tutorId: 'tutor', studentId: 's2', start: at(MON, '09:30'), durationMinutes: 45 }), code('SLOT_UNAVAILABLE'));
});
test('booked time disappears from listSlots', () => {
  const s = setup(); s.book({ tutorId: 'tutor', studentId: 's1', start: at(MON, '10:00'), durationMinutes: 60 });
  const starts = s.listSlots('tutor', at(MON, '00:00'), at(MON, '23:59'), 30).map((x) => new Date(x.start).toISOString().slice(11, 16));
  assert.deepEqual(starts, ['09:00', '09:30', '11:00', '11:30']);
});
test('lessons outside availability are rejected', () => {
  const s = setup();
  assert.throws(() => s.book({ tutorId: 'tutor', studentId: 's1', start: at(MON, '11:30'), durationMinutes: 60 }), code('SLOT_UNAVAILABLE'));
  assert.throws(() => s.book({ tutorId: 'tutor', studentId: 's1', start: at(TUE, '09:00'), durationMinutes: 30 }), code('SLOT_UNAVAILABLE'));
});
test('invalid durations, misaligned starts and unknown tutors are rejected', () => {
  const s = setup();
  assert.throws(() => s.book({ tutorId: 'tutor', studentId: 's1', start: at(MON, '09:00'), durationMinutes: 50 }), code('INVALID_DURATION'));
  assert.throws(() => s.book({ tutorId: 'tutor', studentId: 's1', start: at(MON, '09:15'), durationMinutes: 30 }), code('INVALID_START'));
  assert.throws(() => s.book({ tutorId: 'nobody', studentId: 's1', start: at(MON, '09:00'), durationMinutes: 30 }), code('UNKNOWN_TUTOR'));
});
test('45-minute lessons are allowed', () => {
  const b = setup().book({ tutorId: 'tutor', studentId: 's1', start: at(MON, '09:30'), durationMinutes: 45 });
  assert.ok(same(b.end, at(MON, '10:15')));
});
test('minimum notice and booking horizon are enforced', () => {
  const s = setup({ minNoticeHours: 22, horizonDays: 2 });
  assert.throws(() => s.book({ tutorId: 'tutor', studentId: 's1', start: at(MON, '09:00'), durationMinutes: 30 }), code('TOO_SOON'));
  assert.equal(s.book({ tutorId: 'tutor', studentId: 's1', start: at(MON, '10:00'), durationMinutes: 30 }).status, 'booked');
  const far = setup({ horizonDays: 7 });
  assert.throws(() => far.book({ tutorId: 'tutor', studentId: 's1', start: '2026-11-09T09:00:00.000Z', durationMinutes: 30 }), code('TOO_FAR'));
});
test('buffer between lessons is enforced', () => {
  const s = setup({ bufferMinutes: 15 }); s.book({ tutorId: 'tutor', studentId: 's1', start: at(MON, '09:00'), durationMinutes: 60 });
  assert.throws(() => s.book({ tutorId: 'tutor', studentId: 's2', start: at(MON, '10:00'), durationMinutes: 30 }), code('SLOT_UNAVAILABLE'));
  assert.equal(s.book({ tutorId: 'tutor', studentId: 's2', start: at(MON, '10:30'), durationMinutes: 30 }).status, 'booked');
});
test('students cannot cancel inside the window; tutors can', () => {
  const s = setup({ cancelWindowHours: 24 });
  const b = s.book({ tutorId: 'tutor', studentId: 's1', start: at(MON, '09:00'), durationMinutes: 30 });
  assert.throws(() => s.cancel(b.id, { by: 'student' }), code('CANCEL_WINDOW'));
  assert.equal(s.cancel(b.id, { by: 'tutor' }).status, 'cancelled');
});
test('students can cancel outside the window, cancelling twice fails and time is freed', () => {
  const s = setup({ cancelWindowHours: 24 });
  const b = s.book({ tutorId: 'tutor', studentId: 's1', start: at(TUE, '14:00'), durationMinutes: 60 });
  assert.equal(s.cancel(b.id, { by: 'student' }).status, 'cancelled');
  assert.throws(() => s.cancel(b.id, { by: 'student' }), code('ALREADY_CANCELLED'));
  assert.equal(s.book({ tutorId: 'tutor', studentId: 's2', start: at(TUE, '14:00'), durationMinutes: 60 }).status, 'booked');
  assert.throws(() => s.cancel('nope', { by: 'tutor' }), code('UNKNOWN_BOOKING'));
});
test('a failed reschedule leaves the booking unchanged; a successful one frees the old time', () => {
  const s = setup();
  const a = s.book({ tutorId: 'tutor', studentId: 's1', start: at(TUE, '14:00'), durationMinutes: 60 });
  s.book({ tutorId: 'tutor', studentId: 's2', start: at(MON, '10:00'), durationMinutes: 60 });
  assert.throws(() => s.reschedule(a.id, at(MON, '10:00'), { by: 'tutor' }), code('SLOT_UNAVAILABLE'));
  assert.ok(same(s.upcoming('s1')[0].start, at(TUE, '14:00')));
  const moved = s.reschedule(a.id, at(TUE, '14:30'), { by: 'tutor' });
  assert.ok(same(moved.start, at(TUE, '14:30'))); assert.ok(same(moved.end, at(TUE, '15:30')));
  assert.equal(s.book({ tutorId: 'tutor', studentId: 's3', start: at(MON, '09:00'), durationMinutes: 60 }).status, 'booked');
});
test('a lesson can be rescheduled into time it overlaps with itself', () => {
  const s = setup(); const a = s.book({ tutorId: 'tutor', studentId: 's1', start: at(TUE, '14:00'), durationMinutes: 60 });
  assert.ok(same(s.reschedule(a.id, at(TUE, '14:30'), { by: 'tutor' }).start, at(TUE, '14:30')));
});
test('students cannot reschedule inside the window', () => {
  const s = setup({ cancelWindowHours: 24 });
  const b = s.book({ tutorId: 'tutor', studentId: 's1', start: at(MON, '09:00'), durationMinutes: 30 });
  assert.throws(() => s.reschedule(b.id, at(MON, '10:00'), { by: 'student' }), code('CANCEL_WINDOW'));
});
test('upcoming lists booked lessons for tutor and student, sorted, without cancelled ones', () => {
  const s = setup();
  const late = s.book({ tutorId: 'tutor', studentId: 's1', start: at(TUE, '14:00'), durationMinutes: 30 });
  s.book({ tutorId: 'tutor', studentId: 's1', start: at(MON, '09:00'), durationMinutes: 30 });
  const gone = s.book({ tutorId: 'tutor', studentId: 's2', start: at(MON, '11:00'), durationMinutes: 30 });
  s.cancel(gone.id, { by: 'tutor' });
  assert.deepEqual(s.upcoming('s1').map((b) => new Date(b.start).toISOString()), [at(MON, '09:00'), at(TUE, '14:00')]);
  assert.equal(s.upcoming('tutor').length, 2); assert.equal(s.upcoming('s2').length, 0);
  assert.equal(s.upcoming('s1')[1].id, late.id);
});
test('setWeeklyAvailability replaces earlier availability', () => {
  const s = setup(); s.setWeeklyAvailability('tutor', [{ day: 1, start: '13:00', end: '14:00' }]);
  assert.throws(() => s.book({ tutorId: 'tutor', studentId: 's1', start: at(MON, '09:00'), durationMinutes: 30 }), code('SLOT_UNAVAILABLE'));
  assert.equal(s.listSlots('tutor', at(MON, '00:00'), at(MON, '23:59'), 60).length, 1);
});
