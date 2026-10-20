// Reference implementation used only to validate the hidden tests. Never shown to agents.
const DURATIONS = [30, 45, 60];
const fail = (code, msg) => Object.assign(new Error(msg || code), { code });
const MIN = 60000;
export function createScheduler(options = {}) {
  const o = { now: () => new Date(), minNoticeHours: 12, horizonDays: 56, cancelWindowHours: 24, bufferMinutes: 0, ...options };
  const tutors = new Map(); const bookings = new Map(); let seq = 0;
  const tutor = (id) => { const t = tutors.get(id); if (!t) throw fail('UNKNOWN_TUTOR'); return t; };
  const mins = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
  function check(tutorId, startMs, duration, ignoreId) {
    const t = tutor(tutorId);
    if (!DURATIONS.includes(duration)) throw fail('INVALID_DURATION');
    const d = new Date(startMs);
    if (Number.isNaN(startMs) || d.getUTCMinutes() % 30 || d.getUTCSeconds() || d.getUTCMilliseconds()) throw fail('INVALID_START');
    const now = o.now().getTime();
    if (startMs < now + o.minNoticeHours * 3600000) throw fail('TOO_SOON');
    if (startMs > now + o.horizonDays * 86400000) throw fail('TOO_FAR');
    const endMs = startMs + duration * MIN;
    const day = d.toISOString().slice(0, 10);
    if (t.blocked.has(day)) throw fail('SLOT_UNAVAILABLE');
    const dayStart = Date.parse(day + 'T00:00:00Z');
    const s = (startMs - dayStart) / MIN, e = (endMs - dayStart) / MIN;
    if (!t.blocks.some((b) => b.day === d.getUTCDay() && mins(b.start) <= s && e <= mins(b.end))) throw fail('SLOT_UNAVAILABLE');
    const buf = o.bufferMinutes * MIN;
    for (const b of bookings.values()) {
      if (b.tutorId !== tutorId || b.status !== 'booked' || b.id === ignoreId) continue;
      const bs = Date.parse(b.start), be = Date.parse(b.end);
      if (startMs < be + buf && bs < endMs + buf) throw fail('SLOT_UNAVAILABLE');
    }
    return endMs;
  }
  function get(id) { const b = bookings.get(id); if (!b) throw fail('UNKNOWN_BOOKING'); return b; }
  function guardStudent(b, by) { if (by === 'student' && Date.parse(b.start) - o.now().getTime() < o.cancelWindowHours * 3600000) throw fail('CANCEL_WINDOW'); }
  return {
    addTutor({ id, name }) { tutors.set(id, { id, name, blocks: [], blocked: new Set() }); },
    setWeeklyAvailability(id, blocks) { tutor(id).blocks = blocks.map((b) => ({ ...b })); },
    blockDate(id, date) { tutor(id).blocked.add(date); },
    listSlots(id, fromIso, toIso, duration) {
      tutor(id); if (!DURATIONS.includes(duration)) throw fail('INVALID_DURATION');
      const out = []; const to = Date.parse(toIso);
      let t = Math.ceil(Date.parse(fromIso) / (30 * MIN)) * 30 * MIN;
      for (; t + duration * MIN <= to; t += 30 * MIN) { try { const end = check(id, t, duration); out.push({ start: new Date(t).toISOString(), end: new Date(end).toISOString() }); } catch { /* not bookable */ } }
      return out;
    },
    book({ tutorId, studentId, start, durationMinutes }) {
      const s = Date.parse(start); const end = check(tutorId, s, durationMinutes);
      const b = { id: `b${++seq}`, tutorId, studentId, start: new Date(s).toISOString(), end: new Date(end).toISOString(), status: 'booked' };
      bookings.set(b.id, b); return { ...b };
    },
    cancel(id, { by } = {}) { const b = get(id); if (b.status === 'cancelled') throw fail('ALREADY_CANCELLED'); guardStudent(b, by); b.status = 'cancelled'; return { ...b }; },
    reschedule(id, newStart, { by } = {}) {
      const b = get(id); if (b.status === 'cancelled') throw fail('ALREADY_CANCELLED'); guardStudent(b, by);
      const dur = (Date.parse(b.end) - Date.parse(b.start)) / MIN; const s = Date.parse(newStart);
      const end = check(b.tutorId, s, dur, b.id); b.start = new Date(s).toISOString(); b.end = new Date(end).toISOString(); return { ...b };
    },
    upcoming(userId) { const now = o.now().getTime(); return [...bookings.values()].filter((b) => b.status === 'booked' && (b.tutorId === userId || b.studentId === userId) && Date.parse(b.start) >= now).sort((a, b) => a.start.localeCompare(b.start)).map((b) => ({ ...b })); },
  };
}
