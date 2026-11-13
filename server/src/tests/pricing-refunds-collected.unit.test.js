// specs/pricing-components.md §3 rule 72 — REFUNDS / collected: what each line of a stay collected, in the books or in the
// caisse interne, moved unchanged (PR B reads SETTLEMENT's settledCents instead). Plain objects, no DB.
const test = require('node:test');
const assert = require('node:assert/strict');
const collected = require('../utils/pricing/refunds/collected');
const legacy = require('../utils/refunds');

const { collectedByLine, collectedLinesGone, takeGesteOff, settleSplitCents, collectedAfterArrival } = collected;

const OPTION = { optionId: 7, title: 'Petit-déjeuner', totalPrice: 72, offered: 0, acompteContribTtc: 10, soldeContribTtc: 62 };

test('rule 72 — the legacy module re-exports collectedByLine and collectedLinesGone', () => {
  assert.equal(legacy.collectedByLine, collectedByLine);
  assert.equal(legacy.collectedLinesGone, collectedLinesGone);
});

test('rule 72 — contribs that add up to each paid entry say what every line collected', () => {
  const row = {
    depositPaid: 1, depositAmount: 110, balancePaid: 1, balanceAmount: 400,
    accommodationAcompteContribTtc: 100, touristTaxAcompteContribTtc: 0,
    accommodationSoldeContribTtc: 338, touristTaxSoldeContribTtc: 0,
  };
  const out = collectedByLine({ reservation: row, options: [OPTION], booked: null, taxOnArrival: false });
  assert.equal(out.accommodation, 438);
  assert.equal(out['opt:7'], 72);
});

test('rule 72 — nothing paid collected nothing; the caisse interne reading is separate from the books', () => {
  const unpaid = collectedByLine({ reservation: { depositPaid: 0, balancePaid: 0 }, options: [OPTION] });
  assert.deepEqual(Object.values(unpaid).filter((amount) => amount > 0), []);
  const cashRow = { depositPaid: 1, depositPaidCash: 1, depositAmount: 50, accommodationAcompteContribTtc: 40, touristTaxAcompteContribTtc: 10 };
  assert.deepEqual(collectedByLine({ reservation: cashRow, options: [], cash: false }), { accommodation: 0, touristTax: 0 });
  assert.deepEqual(collectedByLine({ reservation: cashRow, options: [], cash: true }), { accommodation: 50, touristTax: 0 });
});

test('rule 72 — takeGesteOff: the geste comes off the accommodation, then the extras pro rata, the tax last', () => {
  const out = { accommodation: 100, 'opt:1': 30, 'opt:2': 10, touristTax: 8 };
  takeGesteOff(out, { balance: { waivedBooks: 130, waivedInternal: 0 } }, false);
  assert.deepEqual(out, { accommodation: 0, 'opt:1': 7.5, 'opt:2': 2.5, touristTax: 8 });
  const none = { accommodation: 50 };
  takeGesteOff(none, null, false);
  assert.deepEqual(none, { accommodation: 50 });
});

test('rule 72 — settleSplitCents: exact amounts settle in cents, the leftover cent to the largest remainder (ties: earlier key)', () => {
  const rounded = { a: 1.004, b: 2.006 };
  settleSplitCents(rounded, false);
  assert.deepEqual(rounded, { a: 1, b: 2.01 });
  const exact = { a: 10 / 3, b: 10 / 3, c: 10 / 3 };
  settleSplitCents(exact, true);
  assert.deepEqual(exact, { a: 3.34, b: 3.33, c: 3.33 });
});

test('rule 72 — collectedAfterArrival adds a settled end of stay and the settled notes, key by key', () => {
  assert.equal(collectedAfterArrival({}).size, 0);
  const endOfStay = { endOfStayComplementPaid: 1, endOfStayComplementDetail: JSON.stringify([{ key: 'opt:7', label: 'Bain', amount: 12 }]) };
  assert.deepEqual([...collectedAfterArrival(endOfStay)], [['opt:7', { label: 'Bain', amount: 12 }]]);
  const withNote = { ...endOfStay, midStaySettledNotes: JSON.stringify([{ id: 1, paid: true, lines: [{ key: 'opt:7', label: 'Petit-déjeuner', amount: 12 }] }]) };
  assert.deepEqual([...collectedAfterArrival(withNote)], [['opt:7', { label: 'Bain', amount: 24 }]]);
});
