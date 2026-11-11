// specs/control-plane-plans-and-access.md — the subscription state machine: rule 14 (states and
// their day boundaries, with the 7-day monthly / 30-day yearly `due` window), rule 15 (a renewal
// extends from the end, or from today once the end is past) and rule 19 (« Remettre en actif »
// until a date).

const test = require('node:test');
const assert = require('node:assert/strict');
const { stateOf, daysLeft, renewedEndsAt } = require('../utils/lifecycle');
const { parisDay, addMonths } = require('../utils/days');

const yearly = { endsAt: '2026-11-12', billing: 'yearly' };
const monthly = { endsAt: '2026-11-12', billing: 'monthly' };

test('rule 14 — yearly billing: active, then due 30 days before the end', () => {
  assert.equal(stateOf(yearly, '2026-10-12'), 'active');
  assert.equal(stateOf(yearly, '2026-10-13'), 'due');
  assert.equal(stateOf(yearly, '2026-11-11'), 'due');
});

test('rule 14 — monthly billing: due only 7 days before the end (§9 Q10)', () => {
  assert.equal(stateOf(monthly, '2026-10-13'), 'active');
  assert.equal(stateOf(monthly, '2026-11-04'), 'active');
  assert.equal(stateOf(monthly, '2026-11-05'), 'due');
});

test('rule 14 — grace from the end to +7, read-only +8 to +30, suspended from +31', () => {
  assert.equal(stateOf(yearly, '2026-11-12'), 'grace');
  assert.equal(stateOf(yearly, '2026-11-19'), 'grace');
  assert.equal(stateOf(yearly, '2026-11-20'), 'read_only');
  assert.equal(stateOf(yearly, '2026-12-12'), 'read_only');
  assert.equal(stateOf(yearly, '2026-12-13'), 'suspended');
});

test('rule 14 — trial until its last day, archived above everything', () => {
  const trial = { endsAt: '2026-10-31', trialEndsAt: '2026-10-31', billing: 'monthly' };
  assert.equal(stateOf(trial, '2026-10-30'), 'trial');
  assert.equal(stateOf(trial, '2026-10-31'), 'grace');
  assert.equal(stateOf({ ...yearly, archivedAt: '2026-09-01T00:00:00Z' }, '2026-10-01'), 'archived');
});

test('rule 14 — boundaries are Paris days, not UTC ones', () => {
  // 23:30 UTC on 11 November is already 12 November in Paris: the grace has started.
  const day = parisDay(new Date('2026-11-11T23:30:00Z'));
  assert.equal(day, '2026-11-12');
  assert.equal(stateOf(yearly, day), 'grace');
});

test('rule 19 — forced active holds until its date, then the calendar takes over', () => {
  const sub = { ...yearly, forceActiveUntil: '2026-12-20' };
  assert.equal(stateOf(sub, '2026-12-20'), 'active');
  assert.equal(stateOf(sub, '2026-12-21'), 'suspended');
});

test('rule 15 — a renewal extends from the end, or from today once the end is past', () => {
  assert.equal(renewedEndsAt('2026-11-12', 12, '2026-10-01'), '2027-11-12');
  assert.equal(renewedEndsAt('2026-11-12', 1, '2026-12-20'), '2027-01-20');
  for (const today of ['2026-10-20', '2026-11-15', '2026-12-01', '2027-01-10']) {
    const state = stateOf({ ...monthly, endsAt: renewedEndsAt(monthly.endsAt, 1, today) }, today);
    assert.equal(state, 'active', `a monthly payment on ${today} must leave the customer active`);
  }
});

test('rule 14 — days left count to the trial end while in trial, else to the end', () => {
  assert.equal(daysLeft({ endsAt: '2026-10-31', trialEndsAt: '2026-10-31' }, '2026-10-01'), 30);
  assert.equal(daysLeft(yearly, '2026-11-15'), -3);
});

test('month arithmetic clamps to the end of the month', () => {
  assert.equal(addMonths('2027-01-31', 1), '2027-02-28');
  assert.equal(addMonths('2026-10-01', 12), '2027-10-01');
});
