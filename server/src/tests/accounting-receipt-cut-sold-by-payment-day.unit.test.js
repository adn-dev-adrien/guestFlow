// specs/pricing-components.md §3 rules 61-63 (end review R2-5) — a receipt is cut over the lines sold by its payment day: a line sold later on
// the same stay (a drink at another rate, or the same rate rounded apart) never re-cuts a receipt of a month already declared.
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const { skipWithout } = require('../plugins/sdk/testing');
const { create } = require('../utils/accounting/accountingOutput');

const NEEDS_PLAN = { skip: skipWithout(['accounting-export']) };
const REGIME = { regime: 'subject', rate: 10 };

test('rules 61-63 — a deposit paid on 1 March keeps its cut when a drink is sold on 20 March', NEEDS_PLAN, () => {
  const { receiptCutOf } = create({ accountPlan: require('../plugins/accounting-export/accountPlan') });
  const deposit = {
    kind: 'deposit', paidDate: '2027-03-01', encaissementTtc: 100.05, taxTtc: 0, fraction: 1, // date-literal-ok — days handed to a pure function or an injected clock, nothing compares them with the real today
    buckets: [{ name: 'options', ht: 90.95, vat: 9.1, ratePercent: 10 }], commission: null,
  };
  const before = [{ kind: 'option', vatClass: 'options', totalCents: 10005, soldAt: '2027-02-20T10:00:00.000Z' }]; // date-literal-ok — days handed to a pure function or an injected clock, nothing compares them with the real today
  const after = [...before, { kind: 'option', vatClass: 'drinks', totalCents: 334, soldAt: '2027-03-20T18:00:00.000Z' }]; // date-literal-ok — days handed to a pure function or an injected clock, nothing compares them with the real today
  const cut = (entry, lines) => receiptCutOf({ id: 1, readsSaleLines: 1 }, { saleLinesOf: () => lines }, REGIME)(entry).buckets;
  assert.deepEqual(cut(deposit, after), cut(deposit, before), 'the later drink does not move the declared month');
  const late = { ...deposit, paidDate: '2027-03-21' }; // date-literal-ok — days handed to a pure function or an injected clock, nothing compares them with the real today
  assert.notDeepEqual(cut(late, after), cut(late, before), 'a receipt paid after the drink is cut over it too');
});
