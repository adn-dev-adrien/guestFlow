const test = require('node:test');
const assert = require('node:assert/strict');

// specs/finance-dashboard-redesign.md §3 rule 57 (D-HC16, V5-11, 2026-11-06) — a repeated `fiscalYear` names no
// exercise: the dashboard, its detail tables and the stay profile (one shared context) refuse it with
// « Exercice inconnu. »; a single unusable value still reads the current exercise; and the exercise served is
// always among the selector's options.
// The clock is pinned for the whole file (the server test-isolation spec), on the day this was written against.
require('node:test').mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 6, 11) });
const { freshDb, insert } = require('./financeDashboardFixture');
const stayProfileModel = require('../models/stayProfileModel');

const CREATED = '2026-03-02 10:00:00';
const seeded = () => {
  const ctx = freshDb({ properties: ['Gite'] });
  insert(ctx.db, { id: 1, propertyId: 1, startDate: '2026-05-10', endDate: '2026-05-12', balanceAmount: 200, balancePaid: 1, balancePaidDate: '2026-05-12', createdAt: CREATED });
  return ctx;
};

test('rule 57 — a repeated or nested fiscalYear is « Exercice inconnu. » (400) on every read of the shared context', () => {
  const { db, dashboard } = seeded();
  const profile = stayProfileModel.buildModel(db);
  for (const fiscalYear of [['2026', '2025'], { a: '2026' }]) {
    assert.deepEqual(dashboard.getDashboard({ fiscalYear }), { ok: false, status: 400, error: 'Exercice inconnu.' });
    assert.deepEqual(dashboard.getDashboardDetail('stays', { fiscalYear }), { ok: false, status: 400, error: 'Exercice inconnu.' });
    assert.deepEqual(profile.getStayProfile({ fiscalYear }), { ok: false, status: 400, error: 'Exercice inconnu.' });
  }
});

test('rule 57 — a single unusable value still reads the current exercise', () => {
  const { dashboard } = seeded();
  for (const fiscalYear of ['abc', '1999', '', undefined]) {
    const r = dashboard.getDashboard({ fiscalYear });
    assert.equal(r.ok, true);
    assert.equal(r.data.fiscalYear.key, 2026);
  }
});

test('rule 57 (V5-11) — an exercise before the data is served and listed among the options', () => {
  const { db, dashboard } = seeded();
  const d = dashboard.getDashboard({ fiscalYear: '2024' }).data;
  assert.equal(d.fiscalYear.key, 2024);
  assert.ok(d.fiscalYears.some((f) => f.key === 2024), 'the select can show it');
  assert.deepEqual(d.fiscalYears.map((f) => f.key), [...d.fiscalYears.map((f) => f.key)].sort((a, b) => b - a), 'newest first');
  const p = stayProfileModel.buildModel(db).getStayProfile({ fiscalYear: '2024' }).data;
  assert.ok(p.fiscalYears.some((f) => f.key === 2024), 'the stay profile too');
  const current = dashboard.getDashboard({ fiscalYear: '2026' }).data;
  assert.equal(current.fiscalYears.filter((f) => f.key === 2026).length, 1, 'never listed twice');
});
