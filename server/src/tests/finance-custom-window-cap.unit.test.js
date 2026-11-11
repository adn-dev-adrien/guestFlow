const test = require('node:test');
const assert = require('node:assert/strict');

// specs/finance-dashboard-redesign.md rule 51 — a custom window is at most MAX_CUSTOM_WINDOW_DAYS
// wide (two exercises fit), refused fast past it, and the cumulative curve always ends on its last day.
const { resolveWindow, MESSAGES, MAX_CUSTOM_WINDOW_DAYS } = require('../utils/financeWindow');
const { freshDb, insert, THIS_YEAR } = require('./financeDashboardFixture');

const EXERCISE = { key: THIS_YEAR, label: `${THIS_YEAR}`, from: `${THIS_YEAR}-01-01`, to: `${THIS_YEAR}-12-31` };
const plusDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

test('rule 51 — the cap leaves room for two whole exercises', () => {
  assert.ok(MAX_CUSTOM_WINDOW_DAYS >= 731);
  const from = `${THIS_YEAR - 1}-01-01`;
  const twoYears = resolveWindow({ exercise: EXERCISE, kind: 'custom', from, to: `${THIS_YEAR}-12-31` });
  assert.equal(twoYears.ok, true);
  assert.equal(resolveWindow({ exercise: EXERCISE, kind: 'custom', from, to: plusDays(from, MAX_CUSTOM_WINDOW_DAYS) }).ok, true);
});

test('rule 51 — one day past the cap, or « au » 9999-12-31, is refused with the short message', () => {
  const from = `${THIS_YEAR}-01-01`;
  assert.deepEqual(resolveWindow({ exercise: EXERCISE, kind: 'custom', from, to: plusDays(from, MAX_CUSTOM_WINDOW_DAYS + 1) }),
    { ok: false, error: MESSAGES.tooWide });
  assert.deepEqual(resolveWindow({ exercise: EXERCISE, kind: 'custom', from, to: '9999-12-31' }), { ok: false, error: MESSAGES.tooWide });
  assert.equal(MESSAGES.tooWide, 'Période trop longue : 750 jours au plus.');
});

test('rule 51 — the dashboard refuses « au » 9999-12-31 with a 400, at once', () => {
  const { dashboard } = freshDb();
  for (const from of [`${THIS_YEAR}-01-01`, `${THIS_YEAR}-11-01`, `${THIS_YEAR}-12-01`]) {
    const started = Date.now();
    assert.deepEqual(dashboard.getDashboard({ fiscalYear: THIS_YEAR, period: 'custom', from, to: '9999-12-31' }),
      { ok: false, status: 400, error: MESSAGES.tooWide });
    assert.ok(Date.now() - started < 1000);
  }
});

test('rule 51 — at the cap, the weekly curve still ends exactly on the window\'s last day', () => {
  const { db, dashboard } = freshDb();
  const from = `${THIS_YEAR - 1}-01-01`;
  insert(db, { startDate: `${THIS_YEAR - 1}-03-10`, endDate: `${THIS_YEAR - 1}-03-12`, balanceAmount: 200, createdAt: `${THIS_YEAR - 2}-06-01 10:00:00` });
  for (const width of [MAX_CUSTOM_WINDOW_DAYS, MAX_CUSTOM_WINDOW_DAYS - 3, 100]) {
    const to = plusDays(from, width);
    const curve = dashboard.getDashboard({ fiscalYear: THIS_YEAR, period: 'custom', from, to }).data.hero.cumulative;
    assert.equal(curve[0].day, from);
    assert.equal(curve[curve.length - 1].day, to);
    assert.equal(curve[curve.length - 1].x, width);
    assert.equal(curve.length, Math.ceil(width / 7) + 1);
  }
});
