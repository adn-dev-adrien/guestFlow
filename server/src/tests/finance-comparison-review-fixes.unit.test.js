const test = require('node:test');
const assert = require('node:assert/strict');

// specs/finance-revpar-year-over-year.md §3 rules 21, 22 and 23 (review R3-5, R3-6, R3-7, R6-7 of
// 2026-11-06) — the notice names every reason months were left out, a tracking start on 29 February is
// known a year later on 1 March (the pace's date too), and a first of the month reads « 1er ». Pure: today
// is passed in.
// The clock is pinned for the whole file (the server test-isolation spec): every date below is an input of
// a pure function, and « today » never moves either.
require('node:test').mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 6, 11) });
const { comparisonWindow } = require('../utils/financeComparison');
const { snapshotKnownFrom, lastYearSnapshotKnown } = require('../utils/yearOverYear');
const { buildPace } = require('../utils/bookingPace');
const { formatDateLongFr, formatDateLong } = require('../utils/dateFr');

test('rule 21 — clamped by the coverage AND by the months not over: both reasons', () => {
  // date-literal-ok: inputs of a pure function, today passed in.
  const s = comparisonWindow({ window: { from: '2026-10-01', to: '2027-09-30' }, coverage: '2025-12', today: '2027-03-15', trackingStart: '2026-06-01' }).status;
  assert.equal(s.months, 3, 'December to February');
  assert.equal(s.notice, 'Comparaison sur 3 mois sur 12 : les données commencent en décembre 2025, et un mois en cours se compare une fois terminé.');
});

test('rule 22 — a tracking start on 29 February is known on 1 March a year later', () => {
  assert.equal(snapshotKnownFrom('2024-02-29'), '2025-03-01');
  assert.equal(lastYearSnapshotKnown('2025-02-28', '2024-02-29'), false); // date-literal-ok: pure inputs
  assert.equal(lastYearSnapshotKnown('2025-03-01', '2024-02-29'), true); // date-literal-ok: pure inputs
  assert.equal(snapshotKnownFrom('2025-04-10'), '2026-04-10');
  assert.equal(snapshotKnownFrom(null), null);
  const pace = buildPace({ stays: [{ propertyId: 1, startDate: '2024-06-01', endDate: '2024-06-03', totalSejour: 100, bookedOn: '2024-02-28', cancelledOn: null }], today: '2025-01-15', metric: 'reservations', coverageMonth: '2024-06' }); // date-literal-ok: pure inputs
  assert.equal(pace.comparableFrom, '2025-03-01', 'the booking pace says the same day');
});

test('rule 23 — « 1er » on a first of the month, in the notice and in the pace\'s', () => {
  assert.equal(formatDateLongFr('2027-01-01'), '1er janvier 2027');
  assert.equal(formatDateLongFr('2027-04-10'), '10 avril 2027');
  assert.equal(formatDateLong('2027-01-01'), '1 janvier 2027', 'the emails\' formatter is unchanged');
  const notice = comparisonWindow({ window: { from: '2026-12-01', to: '2026-12-31' }, coverage: '2025-01', today: '2026-12-10', trackingStart: '2026-04-10' }).status.notice; // date-literal-ok: pure inputs
  assert.equal(notice, "Comparaison avec l'an dernier une fois le premier mois terminé, à partir du 1er janvier 2027.");
  const bySnapshot = comparisonWindow({ window: { from: '2026-12-01', to: '2026-12-31' }, coverage: '2025-01', today: '2026-12-10', trackingStart: '2025-12-20' }).status.notice; // date-literal-ok: pure inputs
  assert.equal(bySnapshot, "Comparaison avec l'an dernier à partir du 20 décembre 2026, avec un an de dates de réservation.");
  const pace = buildPace({ stays: [{ propertyId: 1, startDate: '2026-06-01', endDate: '2026-06-03', totalSejour: 100, bookedOn: '2025-12-31', cancelledOn: null }], today: '2026-03-01', metric: 'reservations', coverageMonth: '2026-06' }); // date-literal-ok: pure inputs
  assert.match(pace.summary.notice || '', /à partir du 1er janvier 2027/);
});
