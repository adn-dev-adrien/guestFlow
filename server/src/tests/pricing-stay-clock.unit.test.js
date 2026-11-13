// specs/pricing-components.md §3 rules 20 and 44 — STAY CLOCK `phaseOf`: the exact minutes, the calendar answers, the
// two DST days, malformed input refused, `now` injected. Every date below is an input of a pure function.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { phaseOf } = require('../utils/pricing/stayClock');

const SUMMER = { arrivalDate: '2027-06-10', departureDate: '2027-06-12', checkInTime: '15:00', checkOutTime: '10:00' }; // date-literal-ok: pure function input, nothing compares with today
const at = (iso) => new Date(iso);
const phase = (stay, iso) => phaseOf(stay, at(iso)).phase;

test('rule 44 — the check-in minute: 14:59 is before, 15:00 is during', () => {
  assert.equal(phase(SUMMER, '2027-06-10T14:59:59+02:00'), 'before'); // date-literal-ok: pure function input
  assert.equal(phase(SUMMER, '2027-06-10T15:00:00+02:00'), 'during'); // date-literal-ok: pure function input
});

test('rule 44 — the check-out minute: 09:59 is during, 10:00 is after', () => {
  assert.equal(phase(SUMMER, '2027-06-12T09:59:59+02:00'), 'during'); // date-literal-ok: pure function input
  assert.equal(phase(SUMMER, '2027-06-12T10:00:00+02:00'), 'after'); // date-literal-ok: pure function input
});

test('rule 44 — started and defaultCollectAt follow the phase', () => {
  assert.deepEqual(phaseOf(SUMMER, at('2027-06-10T14:00:00+02:00')), { // date-literal-ok: pure function input
    phase: 'before', started: false, defaultCollectAt: 'arrival', arrivalDayReached: true, departureDayReached: false,
  });
  assert.deepEqual(phaseOf(SUMMER, at('2027-06-11T12:00:00+02:00')), { // date-literal-ok: pure function input
    phase: 'during', started: true, defaultCollectAt: 'departure', arrivalDayReached: true, departureDayReached: false,
  });
  assert.deepEqual(phaseOf(SUMMER, at('2027-06-12T18:00:00+02:00')), { // date-literal-ok: pure function input
    phase: 'after', started: true, defaultCollectAt: 'departure', arrivalDayReached: true, departureDayReached: true,
  });
});

test('rule 44 — J-1 at 23:59 is before and the day is not reached; midnight reaches the day, not the hour', () => {
  const evening = phaseOf(SUMMER, at('2027-06-09T23:59:00+02:00')); // date-literal-ok: pure function input
  assert.equal(evening.phase, 'before');
  assert.equal(evening.arrivalDayReached, false);
  const midnight = phaseOf(SUMMER, at('2027-06-10T00:00:00+02:00')); // date-literal-ok: pure function input
  assert.equal(midnight.phase, 'before');
  assert.equal(midnight.started, false);
  assert.equal(midnight.arrivalDayReached, true);
});

test('rule 44 — the Paris day is the calendar answer, not the UTC one', () => {
  // 23:30 UTC on the 9th is already 01:30 on the 10th in Paris (summer).
  assert.equal(phaseOf(SUMMER, at('2027-06-09T23:30:00Z')).arrivalDayReached, true); // date-literal-ok: pure function input
  assert.equal(phaseOf(SUMMER, at('2027-06-09T21:59:00Z')).arrivalDayReached, false); // date-literal-ok: pure function input
});

test('rule 44 — winter and summer offsets give the same wall-clock answer', () => {
  const winter = { arrivalDate: '2027-01-20', departureDate: '2027-01-22', checkInTime: '15:00', checkOutTime: '10:00' }; // date-literal-ok: pure function input
  assert.equal(phase(winter, '2027-01-20T14:59:00+01:00'), 'before'); // date-literal-ok: pure function input
  assert.equal(phase(winter, '2027-01-20T15:00:00+01:00'), 'during'); // date-literal-ok: pure function input
  assert.equal(phase(winter, '2027-01-20T13:59:00Z'), 'before'); // date-literal-ok: pure function input
  assert.equal(phase(winter, '2027-01-20T14:00:00Z'), 'during'); // date-literal-ok: pure function input
});

test('rule 44 — DST, last Sunday of March: a 02:30 check-in that never shows is reached at 03:00', () => {
  const stay = { arrivalDate: '2027-03-28', departureDate: '2027-03-30', checkInTime: '02:30', checkOutTime: '10:00' }; // date-literal-ok: pure function input
  assert.equal(phase(stay, '2027-03-28T01:59:00+01:00'), 'before'); // date-literal-ok: pure function input
  assert.equal(phase(stay, '2027-03-28T03:00:00+02:00'), 'during'); // date-literal-ok: pure function input
  assert.equal(phase(stay, '2027-03-28T03:29:00+02:00'), 'during'); // date-literal-ok: pure function input
});

test('rule 44 — DST, last Sunday of March: a check-out on the short day is read on the wall clock', () => {
  const stay = { arrivalDate: '2027-03-27', departureDate: '2027-03-28', checkInTime: '15:00', checkOutTime: '10:00' }; // date-literal-ok: pure function input
  assert.equal(phase(stay, '2027-03-28T09:59:00+02:00'), 'during'); // date-literal-ok: pure function input
  assert.equal(phase(stay, '2027-03-28T10:00:00+02:00'), 'after'); // date-literal-ok: pure function input
});

test('rule 44 — DST, last Sunday of October: a 02:30 check-in that shows twice is reached at the first one, and stays reached', () => {
  const stay = { arrivalDate: '2027-10-31', departureDate: '2027-11-02', checkInTime: '02:30', checkOutTime: '10:00' }; // date-literal-ok: pure function input
  assert.equal(phase(stay, '2027-10-31T02:29:00+02:00'), 'before'); // date-literal-ok: pure function input
  assert.equal(phase(stay, '2027-10-31T02:30:00+02:00'), 'during'); // date-literal-ok: pure function input
  assert.equal(phase(stay, '2027-10-31T02:30:00+01:00'), 'during'); // date-literal-ok: pure function input
  assert.equal(phase(stay, '2027-10-31T02:59:00+01:00'), 'during'); // date-literal-ok: pure function input
});

test('rule 44 — DST, last Sunday of October: a check-out at 02:30 is reached at the first 02:30', () => {
  const stay = { arrivalDate: '2027-10-30', departureDate: '2027-10-31', checkInTime: '15:00', checkOutTime: '02:30' }; // date-literal-ok: pure function input
  assert.equal(phase(stay, '2027-10-31T02:29:00+02:00'), 'during'); // date-literal-ok: pure function input
  assert.equal(phase(stay, '2027-10-31T02:30:00+02:00'), 'after'); // date-literal-ok: pure function input
  assert.equal(phase(stay, '2027-10-31T02:30:00+01:00'), 'after'); // date-literal-ok: pure function input
});

test('rule 44 — now is injected: a Date, or milliseconds; the process time zone changes nothing', () => {
  const instant = at('2027-06-10T15:00:00+02:00'); // date-literal-ok: pure function input
  assert.equal(phaseOf(SUMMER, instant.getTime()).phase, 'during');
  const script = `const { phaseOf } = require(${JSON.stringify(path.join(__dirname, '..', 'utils', 'pricing', 'stayClock'))});`
    + `const s = ${JSON.stringify(SUMMER)};`
    + `process.stdout.write([ '2027-06-10T14:59:00+02:00', '2027-06-10T15:00:00+02:00' ].map((t) => phaseOf(s, new Date(t)).phase).join());`; // date-literal-ok: pure function input
  for (const TZ of ['Pacific/Auckland', 'America/Los_Angeles', 'UTC']) {
    const out = spawnSync(process.execPath, ['-e', script], { env: { ...process.env, TZ }, encoding: 'utf8' });
    assert.equal(out.stdout, 'before,during', TZ);
  }
});

test('rule 44 — the arrival mark and the arrival SAS do not start a stay', () => {
  const marked = { ...SUMMER, checkInDone: 1, arrivalSasDoneAt: '2027-06-10T09:00:00', arrivalMarked: true }; // date-literal-ok: pure function input
  assert.deepEqual(phaseOf(marked, at('2027-06-10T09:00:00+02:00')), phaseOf(SUMMER, at('2027-06-10T09:00:00+02:00'))); // date-literal-ok: pure function input
  assert.equal(phaseOf(marked, at('2027-06-10T09:00:00+02:00')).started, false); // date-literal-ok: pure function input
});

test('rule 44 — a missing time is refused: the resolver fills it, the unit never guesses', () => {
  for (const missing of [undefined, null, '']) {
    assert.throws(() => phaseOf({ ...SUMMER, checkInTime: missing }, at('2027-06-10T16:00:00+02:00')), { code: 'STAY_CLOCK_INVALID' }); // date-literal-ok: pure function input
    assert.throws(() => phaseOf({ ...SUMMER, checkOutTime: missing }, at('2027-06-10T16:00:00+02:00')), { code: 'STAY_CLOCK_INVALID' }); // date-literal-ok: pure function input
  }
});

test('rule 44 — a malformed HH:MM is refused', () => {
  const now = at('2027-06-10T16:00:00+02:00'); // date-literal-ok: pure function input
  for (const bad of ['9:00', '24:00', '15:60', '1500', '15h00', '15:00:00', ' 15:00', 1500, true, {}]) {
    assert.throws(() => phaseOf({ ...SUMMER, checkInTime: bad }, now), { code: 'STAY_CLOCK_INVALID' }, String(bad));
    assert.throws(() => phaseOf({ ...SUMMER, checkOutTime: bad }, now), { code: 'STAY_CLOCK_INVALID' }, String(bad));
  }
});

test('rule 44 — a malformed day or a malformed now is refused', () => {
  const now = at('2027-06-10T16:00:00+02:00'); // date-literal-ok: pure function input
  for (const bad of ['2027-02-30', '2027-6-10', '10/06/2027', '', null, undefined, 20270610]) { // date-literal-ok: pure function input
    assert.throws(() => phaseOf({ ...SUMMER, arrivalDate: bad }, now), { code: 'STAY_CLOCK_INVALID' }, String(bad));
    assert.throws(() => phaseOf({ ...SUMMER, departureDate: bad }, now), { code: 'STAY_CLOCK_INVALID' }, String(bad));
  }
  for (const bad of [undefined, null, 'now', NaN, new Date('nope'), '2027-06-10T16:00:00+02:00']) { // date-literal-ok: pure function input
    assert.throws(() => phaseOf(SUMMER, bad), { code: 'STAY_CLOCK_INVALID' }, String(bad));
  }
  assert.throws(() => phaseOf(undefined, now), { code: 'STAY_CLOCK_INVALID' });
});

test('rule 44 — the unit file reads no clock: no Date.now(), no new Date() without an argument', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'utils', 'pricing', 'stayClock.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(source, /\bDate\.now\s*\(/);
  assert.doesNotMatch(source, /new Date\(\s*\)/);
  assert.doesNotMatch(source, /require\(/);
});

test('rule 44 — DST, last Sunday of October: after a 02:30 check-out the repeated hour does not take the stay back to « during »', () => {
  const stay = { arrivalDate: '2026-10-24', departureDate: '2026-10-25', checkInTime: '15:00', checkOutTime: '02:30' }; // date-literal-ok: pure function input
  assert.equal(phase(stay, '2026-10-25T00:29:00Z'), 'during'); // date-literal-ok: pure function input
  assert.equal(phase(stay, '2026-10-25T00:30:00Z'), 'after'); // date-literal-ok: pure function input
  for (const instant of ['2026-10-25T01:00:00Z', '2026-10-25T01:15:00Z', '2026-10-25T01:29:00Z', '2026-10-25T01:30:00Z']) { // date-literal-ok: pure function input
    assert.equal(phase(stay, instant), 'after', instant);
  }
});

test('rule 44 — DST, last Sunday of October: the same for a check-in, once reached it stays reached', () => {
  const stay = { arrivalDate: '2026-10-25', departureDate: '2026-10-27', checkInTime: '02:30', checkOutTime: '10:00' }; // date-literal-ok: pure function input
  assert.equal(phase(stay, '2026-10-25T00:29:00Z'), 'before'); // date-literal-ok: pure function input
  for (const instant of ['2026-10-25T00:30:00Z', '2026-10-25T01:00:00Z', '2026-10-25T01:29:00Z']) { // date-literal-ok: pure function input
    assert.equal(phase(stay, instant), 'during', instant);
  }
});

test('rule 44 — DST, last Sunday of March: a 02:30 check-out that never shows is reached at 03:00', () => {
  const stay = { arrivalDate: '2027-03-27', departureDate: '2027-03-28', checkInTime: '15:00', checkOutTime: '02:30' }; // date-literal-ok: pure function input
  assert.equal(phase(stay, '2027-03-28T00:59:00Z'), 'during'); // date-literal-ok: pure function input
  assert.equal(phase(stay, '2027-03-28T01:00:00Z'), 'after'); // date-literal-ok: pure function input
});

test('rule 44 — an oracle over random stays and instants, the two DST days included, agrees with the instant reading', () => {
  const parisFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const stampOf = (ms) => { const p = Object.fromEntries(parisFormat.formatToParts(new Date(ms)).map((x) => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`; };
  const firstOf = (day, time) => {
    const [y, m, d] = day.split('-').map(Number);
    const [h, mi] = time.split(':').map(Number);
    const found = [2, 1].map((offset) => Date.UTC(y, m - 1, d, h - offset, mi)).filter((ms) => stampOf(ms) === `${day}T${time}`);
    return found.length ? Math.min(...found) : null;
  };
  let seed = 7;
  const random = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; }; // xorshift: reproducible
  const pad = (n) => String(n).padStart(2, '0');
  const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
  // Stays that straddle the two clock changes of 2026-2027, so the fold and the gap are drawn often.
  const anchors = [Date.UTC(2026, 2, 28), Date.UTC(2026, 9, 24), Date.UTC(2027, 2, 27), Date.UTC(2027, 9, 30)]; // date-literal-ok: pure function input
  let compared = 0;
  for (let i = 0; i < 4000; i += 1) {
    const base = anchors[i % anchors.length] + Math.floor(random() * 3) * 86400000;
    const arrival = dayOf(base);
    const departure = dayOf(base + (1 + Math.floor(random() * 3)) * 86400000);
    const checkIn = `${pad(Math.floor(random() * 24))}:${pad(Math.floor(random() * 4) * 15)}`;
    const checkOut = `${pad(Math.floor(random() * 24))}:${pad(Math.floor(random() * 4) * 15)}`;
    const now = base + Math.floor(random() * 5 * 24 * 60) * 60000;
    const from = firstOf(arrival, checkIn);
    const until = firstOf(departure, checkOut);
    if (from === null || until === null) continue;
    compared += 1;
    const expected = now < from ? 'before' : (now < until ? 'during' : 'after');
    assert.equal(phaseOf({ arrivalDate: arrival, departureDate: departure, checkInTime: checkIn, checkOutTime: checkOut }, now).phase, expected, `${arrival} ${checkIn} -> ${departure} ${checkOut} at ${new Date(now).toISOString()}`);
  }
  assert.ok(compared > 3000);
});
