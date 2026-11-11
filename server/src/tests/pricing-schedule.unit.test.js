// specs/pricing-components.md §3 rules 22 and 50 — SCHEDULE alone: the acompte and the solde (percentage, overrides,
// platform single payment, installment plan, a paid bucket that keeps what it collected), their due dates, the arrival
// complement and the end-of-stay complement amounts. No DB, no port: the ledger readings are plain values.
const test = require('node:test');
const assert = require('node:assert/strict');
const { planSchedule, settingsSchema } = require('../utils/pricing/schedule');

const DATES = { booking: '2027-01-04', start: '2027-04-10', end: '2027-04-14' }; // date-literal-ok: pure date arithmetic, nothing compares with today

const channelOf = (kind) => ({
  direct: { platformSale: false, ownChannel: true, namedChannel: false },
  platform: { platformSale: true, ownChannel: false, namedChannel: true },
}[kind]);

function input(patch = {}) {
  const base = {
    totals: {
      finalPrice: 1000, totalStayPrice: 1040, touristTaxTotal: 40, touristTaxAddedGuestsAmount: 0, touristTaxInComplement: false,
      isTouristTaxCollectedOnArrival: false, forcedItemsTotal: 0, complementForcedItemsTotal: 0, platformGrossPin: null,
    },
    policy: {
      settings: { depositPercent: 30, depositEnabled: 1, depositDueDays: 7, balanceDaysBefore: 30 },
      channel: channelOf('direct'),
      platform: 'direct',
      platformTakesDeposit: false,
      platformPayoutDueDays: undefined,
      quoteKind: 'reservation',
      devisPromise: null,
      validUntil: null,
      bookingDate: DATES.booking,
      startDate: DATES.start,
      endDate: DATES.end,
      bookingId: 0,
      depositDisabled: false,
    },
    planLines: {
      midStayExtras: { lines: [], byKey: {} }, midStayTotal: 0, midStayUnforced: 0, midStaySettledTotal: 0,
      midStayRemainingTotal: 0, midStaySettledNotes: [], endOfStaySasAmount: 0, endOfStaySasAmountAuto: null,
    },
    overrides: { depositAmountOverride: null, complementAmountOverride: null },
    receipts: {
      depositPaid: 0, balancePaid: 0, complementPaid: 0, depositAmount: null, balanceAmount: 0, complementAmount: 0,
      existingDepositDueDate: null, paidSoldeCaptured: false, endOfStayComplementSettled: false,
    },
    ledger: { splitReceived: null, installmentPlan: null },
  };
  const merged = {};
  for (const key of Object.keys(base)) merged[key] = { ...base[key], ...(patch[key] || {}) };
  return merged;
}

test('rule 22 — the acompte is the percentage of the accommodation, the solde carries the rest and the whole tourist tax', () => {
  const plan = planSchedule(input());
  assert.equal(plan.preArrivalAmount, 1040);
  assert.equal(plan.accommodationPreArrival, 1000);
  assert.equal(plan.autoDepositAmount, 300);
  assert.equal(plan.resolvedDepositAmount, 300);
  assert.equal(plan.resolvedBalanceAmount, 740);
  assert.equal(plan.resolvedComplementAmount, 0);
});

test('rule 22 — the due dates: acompte `depositDueDays` after the booking, solde `balanceDaysBefore` before arrival', () => {
  const plan = planSchedule(input());
  assert.equal(plan.depositDueDate, '2027-01-11'); // date-literal-ok: pure date arithmetic, nothing compares with today
  assert.equal(plan.balanceDueDate, '2027-03-11'); // date-literal-ok: pure date arithmetic, nothing compares with today
});

test('rule 22 — a manual acompte is clamped to the accommodation, the solde absorbs the rest', () => {
  const plan = planSchedule(input({ overrides: { depositAmountOverride: 5000 } }));
  assert.equal(plan.resolvedDepositAmount, 1000);
  assert.equal(plan.resolvedBalanceAmount, 40);
  const none = planSchedule(input({ overrides: { depositAmountOverride: -10 } }));
  assert.equal(none.resolvedDepositAmount, 0);
  assert.equal(none.resolvedBalanceAmount, 1040);
});

test('rule 22 — a property with the acompte switched off, or a reservation without one, pays one amount', () => {
  const off = planSchedule(input({ policy: { settings: { depositPercent: 30, depositEnabled: 0, balanceDaysBefore: 30 } } }));
  assert.equal(off.resolvedDepositAmount, 0);
  assert.equal(off.resolvedBalanceAmount, 1040);
  assert.equal(off.depositDueDate, null);
  const disabled = planSchedule(input({ policy: { depositDisabled: true } }));
  assert.equal(disabled.resolvedDepositAmount, 0);
  assert.equal(disabled.resolvedBalanceAmount, 1040);
});

test('rule 22 — a platform stay is one payment unless that platform takes an acompte', () => {
  const policy = { channel: channelOf('platform'), platform: 'Booking.com' };
  const single = planSchedule(input({ policy }));
  assert.equal(single.platformIsNonDirect, true);
  assert.equal(single.resolvedDepositAmount, 0);
  assert.equal(single.resolvedBalanceAmount, 1040);
  const split = planSchedule(input({ policy: { ...policy, platformTakesDeposit: true } }));
  assert.equal(split.resolvedDepositAmount, 300);
  assert.equal(split.resolvedBalanceAmount, 740);
});

test('rule 22 — a paid solde keeps what it collected; the rise goes to the arrival complement', () => {
  const plan = planSchedule(input({
    receipts: { balancePaid: 1, balanceAmount: 800, depositAmount: 0 },
  }));
  assert.equal(plan.resolvedBalanceAmount, 800);
  assert.equal(plan.resolvedDepositAmount, 0);
  assert.equal(plan.resolvedComplementAmount, 240);
  assert.equal(plan.rawComplement, 240);
});

test('rule 22 — forced lines and a tax collected on arrival make the arrival complement from the first save', () => {
  const plan = planSchedule(input({
    totals: { forcedItemsTotal: 100, complementForcedItemsTotal: 100, isTouristTaxCollectedOnArrival: true },
  }));
  assert.equal(plan.taxInComplement, 40);
  assert.equal(plan.preArrivalAmount, 900);
  assert.equal(plan.resolvedComplementAmount, 140);
  assert.equal(plan.resolvedDepositAmount, 270);
});

test('rule 22 — the operator adjusts the complement last; the engine figure stays as `autoComplementAmount`', () => {
  const plan = planSchedule(input({
    totals: { forcedItemsTotal: 100, complementForcedItemsTotal: 100 },
    overrides: { complementAmountOverride: 55.5 },
  }));
  assert.equal(plan.autoComplementAmount, 100);
  assert.equal(plan.resolvedComplementAmount, 55.5);
});

test('rule 22 — an installment plan, handed over as a value, replaces the acompte and the solde', () => {
  const plan = planSchedule(input({ policy: { bookingId: 12 }, ledger: { installmentPlan: { scheduled: 1040, paid: 0, allPaid: false } } }));
  assert.equal(plan.installmentPlan.scheduled, 1040);
  assert.equal(plan.resolvedDepositAmount, 0);
  assert.equal(plan.resolvedBalanceAmount, 0);
  assert.equal(plan.planScheduled, 1040);
  assert.equal(plan.resolvedComplementAmount, 0);
});

test('rule 22 — no plan is read once a bucket is collected', () => {
  const plan = planSchedule(input({ receipts: { depositPaid: 1, depositAmount: 300 } }));
  assert.equal(plan.installmentPlan, null);
  assert.equal(plan.resolvedBalanceAmount, 740);
});

test('rule 48 — planSchedule takes values, never the port: a ledger whose functions throw is not asked', () => {
  const trap = () => assert.fail('the unit read the port');
  const plan = planSchedule({ ...input({ receipts: { balancePaid: 1, balanceAmount: 500 } }), paymentLedger: { installments: trap, splitReceived: trap } });
  assert.equal(typeof plan.preArrivalAmount, 'number');
});

test('rule 48 — the schedule step reads the ledger under the conditions the plan always read it, and hands the unit values', () => {
  const step = require('../utils/pricing/steps/schedule');
  const reads = [];
  const ledger = {
    installments: (id) => { reads.push(['installments', id]); return { scheduled: 1040, paid: 0, allPaid: false }; },
    splitReceived: (id) => { reads.push(['splitReceived', id]); return null; },
  };
  const ctxOf = (patch = {}) => {
    const base = input(patch);
    const { settings, ...policy } = base.policy;
    const { bookingDate, ...rest } = policy;
    return {
      ...base.totals, ...rest, ...base.planLines, ...base.overrides, ...base.receipts,
      settings: { schedule: settings }, paymentLedger: ledger, clock: { bookingDate, existingDepositDueDate: base.receipts.existingDepositDueDate },
    };
  };
  assert.equal(step.apply(ctxOf({ policy: { bookingId: 12 } })).installmentPlan.scheduled, 1040);
  assert.deepEqual(reads, [['installments', 12]]);
  reads.length = 0;
  assert.equal(step.apply(ctxOf({ policy: { bookingId: 12 }, receipts: { depositPaid: 1, depositAmount: 300 } })).installmentPlan, null);
  assert.deepEqual(reads, [['splitReceived', 12]]);
  reads.length = 0;
  assert.equal(step.apply(ctxOf({ policy: { bookingId: 12, platform: 'booking', channel: channelOf('platform') } })).installmentPlan, null);
  assert.deepEqual(reads, []);
});

test('rule 22 — the end-of-stay complement is the departure SAS plus what is still due of the mid-stay sales', () => {
  const plan = planSchedule(input({
    planLines: { endOfStaySasAmount: 30, endOfStaySasAmountAuto: 25, midStayRemainingTotal: 12.5 },
  }));
  assert.equal(plan.endOfStayComplementTotal, 42.5);
  assert.equal(plan.endOfStayComplementAutoTotal, 37.5);
});

test('rule 50 — settingsSchema: the percentage, the switch and the day counts refuse nonsense', () => {
  const by = Object.fromEntries(settingsSchema.map((entry) => [entry.key, entry]));
  assert.deepEqual(Object.keys(by).sort(), ['balanceDaysBefore', 'cancelAfterBalanceDueDays', 'depositDueDays', 'depositEnabled', 'depositPercent']);
  assert.equal(by.depositPercent.validate(30), null);
  assert.notEqual(by.depositPercent.validate(101), null);
  assert.notEqual(by.depositEnabled.validate(2), null);
  assert.equal(by.balanceDaysBefore.validate(30), null);
  assert.notEqual(by.depositDueDays.validate(-1), null);
});

test('rule 50 — SettingsProvider.for("schedule") reads today\'s property columns, a NULL column stays NULL, an absent one takes the engine\'s default', () => {
  const Database = require('better-sqlite3');
  const settingsProvider = require('../models/ports/settingsProvider');
  const db = new Database(':memory:');
  db.exec('CREATE TABLE properties (id INTEGER PRIMARY KEY, depositPercent REAL, depositEnabled INTEGER, depositDueDays INTEGER, balanceDaysBefore INTEGER, cancelAfterBalanceDueDays INTEGER)');
  db.prepare('INSERT INTO properties (id, depositPercent, depositEnabled, depositDueDays, balanceDaysBefore, cancelAfterBalanceDueDays) VALUES (1, 25, 1, 5, 21, NULL)').run();
  const settings = settingsProvider.create(db).for('schedule', { propertyId: 1 });
  assert.deepEqual(settings, {
    depositPercent: 25, depositEnabled: 1, depositDueDays: 5, balanceDaysBefore: 21, cancelAfterBalanceDueDays: null,
  });
  assert.deepEqual(settingsProvider.create(db).for('schedule', { propertyId: 99 }), {
    depositPercent: 0, depositEnabled: 1, depositDueDays: 7, balanceDaysBefore: 30, cancelAfterBalanceDueDays: 7,
  });
  db.close();
});
