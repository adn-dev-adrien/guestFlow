// specs/pricing-components.md §3 rules 19, 20, 45 and 71 — the sites that PR C moved behind the stay clock keep the day comparison they replaced:
// the day before an arrival, the arrival day and the day after. The static side (no raw comparison left) is the `dates` guard of
// `no-duplicate-formulas`; this suite is the behaviour side, through the sites that are pure.
const test = require('node:test');
const assert = require('node:assert/strict');
const stayClock = require('../utils/pricing/stayClock');
const stayClockModel = require('../models/stayClockModel');
const sdk = require('../plugins/sdk');
const { isIntakeOnStartedStay } = require('../utils/platformIntakePort');
const { platformPriceCheck } = require('../utils/platformPriceCheck');
const { optionalPlugin, skipWithout } = require('../plugins/sdk/testing');

const { validateStayInput } = optionalPlugin(() => require('../plugins/website-booking/publicInputValidation'));

const ARRIVAL = '2031-06-10';
const BEFORE = '2031-06-09';
const AFTER = '2031-06-11';

test('rule 45 — the day predicates are the comparisons they replace: reached from the arrival day on, passed from the day after', () => {
  assert.deepEqual([BEFORE, ARRIVAL, AFTER].map((today) => stayClock.dayReached(ARRIVAL, today)), [false, true, true]);
  assert.deepEqual([BEFORE, ARRIVAL, AFTER].map((today) => stayClock.dayPassed(ARRIVAL, today)), [false, false, true]);
  for (const today of [BEFORE, ARRIVAL, AFTER]) {
    assert.equal(stayClock.dayReached(ARRIVAL, today), ARRIVAL <= today);
    assert.equal(stayClock.dayPassed(ARRIVAL, today), ARRIVAL < today);
  }
});

test('rule 71 — a plugin reaches the same predicates through the SDK stayClock module', () => {
  const core = sdk.coreModule('stayClock');
  assert.equal(core.dayReached, stayClock.dayReached);
  assert.equal(core.dayPassed, stayClock.dayPassed);
  assert.equal(stayClockModel.dayReached, stayClock.dayReached);
});

test('rules 19, 71 — the intakes\' started-stay refusal is the arrival day reached', () => {
  assert.deepEqual([BEFORE, ARRIVAL, AFTER].map((today) => isIntakeOnStartedStay(ARRIVAL, today)), [false, true, true]);
});

test('rule 45 — the platform price check skips a stay from its arrival day on', async () => {
  const quote = { platformGrossAmount: 400 };
  const stay = { kind: 'reservation', startDate: ARRIVAL, platform: 'Booking' };
  for (const today of [ARRIVAL, AFTER]) assert.equal(await platformPriceCheck({ quote, stay, nightsReplayed: 3, loadContext: () => { throw new Error('read'); }, today }), null);
});

test('rule 45 — the public form refuses an arrival in the past, not on the day itself', { skip: skipWithout(['website-booking']) }, () => {
  const body = (startDate) => ({ propertyId: 1, startDate, endDate: '2031-06-14', adults: 2, children: 0, babies: 0 });
  const refused = (today, startDate) => (validateStayInput(body(startDate), { todayIso: today }).errors || []).some((e) => e.field === 'startDate' && e.issue === 'must not be in the past');
  assert.equal(refused(ARRIVAL, BEFORE), true);
  assert.equal(refused(ARRIVAL, ARRIVAL), false);
  assert.equal(refused(ARRIVAL, AFTER), false);
});
