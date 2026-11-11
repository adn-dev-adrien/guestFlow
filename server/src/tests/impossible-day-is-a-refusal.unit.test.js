// specs/finance-dashboard-redesign.md rule 51 and specs/vat-optional-mode.md rule 15, readings of 2026-11-03
// (review of PR #940, side note) — a YYYY-MM-DD that names no day of the calendar (month 13 or 00, day 00 or
// 32) is refused with the endpoint's own message. The round-trip used to run `toISOString()` on an Invalid
// Date: a RangeError, so a 500 where the API owes a 400 / 422.
const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveWindow, MESSAGES } = require('../utils/financeWindow');
const { validateSwitch } = require('../utils/vatRegime');
const { freshDb, THIS_YEAR, TODAY } = require('./financeDashboardFixture');

const EXERCISE = { key: THIS_YEAR, label: `${THIS_YEAR}`, from: `${THIS_YEAR}-01-01`, to: `${THIS_YEAR}-12-31` };
const IMPOSSIBLE = [`${THIS_YEAR}-13-08`, `${THIS_YEAR}-00-10`, `${THIS_YEAR}-06-00`, `${THIS_YEAR}-06-32`, `${THIS_YEAR}-02-30`, `${THIS_YEAR}-99-99`];

test('rule 51: an impossible « Du » or « Au » is « Deux dates à choisir. », never a throw', () => {
  for (const bad of IMPOSSIBLE) {
    const sound = `${THIS_YEAR}-06-15`;
    for (const [from, to] of [[bad, sound], [sound, bad], [bad, bad]]) {
      assert.deepEqual(resolveWindow({ exercise: EXERCISE, kind: 'custom', from, to, today: TODAY }),
        { ok: false, error: MESSAGES.missingDates }, `${from} → ${to}`);
    }
  }
});

test('rule 51: the dashboard and its detail answer 400 on an impossible day, as the API does', () => {
  const { dashboard } = freshDb();
  const from = `${THIS_YEAR}-01-01`;
  for (const to of IMPOSSIBLE) {
    assert.deepEqual(dashboard.getDashboard({ fiscalYear: THIS_YEAR, period: 'custom', from, to }),
      { ok: false, status: 400, error: MESSAGES.missingDates }, to);
    const detail = dashboard.getDashboardDetail('stays', { fiscalYear: THIS_YEAR, period: 'custom', from: to, to: `${THIS_YEAR}-12-31` });
    assert.equal(detail.ok, false, to);
    assert.equal(detail.status, 400, to);
  }
  assert.equal(dashboard.getDashboard({ fiscalYear: THIS_YEAR, period: 'custom', from, to: `${THIS_YEAR}-12-31` }).ok, true);
});

test('vat rule 15: an impossible effectiveFrom is « Date invalide », never a throw', () => {
  for (const effectiveFrom of IMPOSSIBLE) {
    for (const basis of ['booking', 'arrival']) {
      assert.deepEqual(validateSwitch({ regime: 'not_subject', basis, effectiveFrom }, [], { today: TODAY }).errors,
        { effectiveFrom: 'Date invalide' }, `${basis} ${effectiveFrom}`);
    }
  }
});
