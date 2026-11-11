// specs/pricing-components.md §3 rule 41 — ALLOWANCES: the read-only form of the stay's free units and free minutes. The numbers
// are the engine's own: `consumeAllowance` equals `applyFreeUnitsToLine` on every grant, `releaseAllowance` gives a removed
// line's share back, and the stay's ledger grants what the sold snapshot says.
const test = require('node:test');
const assert = require('node:assert/strict');
const allowances = require('../utils/pricing/allowances');
const pricing = require('../utils/pricing');

const { consumeAllowance, releaseAllowance, createFreeUnitsLedger, applyFreeUnitsToLine, applyPerHourFreeMinutes, normalizeBilledUnits } = allowances;

test('rule 41 — the engine\'s free-units helper is the allowances\' own: one definition, still exported to the SDK', () => {
  assert.equal(pricing.applyFreeUnitsToLine, applyFreeUnitsToLine);
});

test('rule 41 — consumeAllowance serves the units the stay was granted, never more than the line bills', () => {
  assert.deepEqual(consumeAllowance({ granted: 2, isDirect: true, billedUnits: 3, unitPrice: 6 }), { used: 2, amount: 12, chargedUnits: 1, realTotal: 6 });
  assert.deepEqual(consumeAllowance({ granted: 5, isDirect: true, billedUnits: 3, unitPrice: 6 }), { used: 3, amount: 18, chargedUnits: 0, realTotal: 0 });
  assert.deepEqual(consumeAllowance({ granted: 0, isDirect: true, billedUnits: 3, unitPrice: 6 }), { used: 0, amount: 0, chargedUnits: 3, realTotal: 18 });
});

test('rule 41 — a commissioned channel gets no free unit: the pack is the single difference with it', () => {
  assert.deepEqual(consumeAllowance({ granted: 2, isDirect: false, billedUnits: 3, unitPrice: 6 }), { used: 0, amount: 0, chargedUnits: 3, realTotal: 18 });
});

test('rule 41 — consumeAllowance gives the engine\'s numbers on a grid of grants, units, prices and channels', () => {
  for (const isDirect of [true, false]) {
    for (const granted of [0, 1, 2, 2.5, 7]) {
      for (const billedUnits of [0, 1, 2, 3.5, 10]) {
        for (const unitPrice of [0, 4.99, 6, 12.345]) {
          const engine = applyFreeUnitsToLine({ option: { freeUnits: 0 }, isDirectBooking: isDirect, billedUnits, unitPrice, lockedFreeUnits: granted });
          assert.deepEqual(
            consumeAllowance({ granted, isDirect, billedUnits, unitPrice }),
            { used: engine.freeUnits, amount: engine.freeUnitsAmount, chargedUnits: engine.chargedUnits, realTotal: engine.realTotal },
            JSON.stringify({ isDirect, granted, billedUnits, unitPrice }),
          );
        }
      }
    }
  }
});

test('rule 41 — without a sold grant, the option\'s own free units stand (applyFreeUnitsToLine)', () => {
  assert.equal(applyFreeUnitsToLine({ option: { freeUnits: 2 }, isDirectBooking: true, billedUnits: 5, unitPrice: 1 }).freeUnits, 2);
  assert.equal(applyFreeUnitsToLine({ option: { freeUnits: 2 }, isDirectBooking: true, billedUnits: 5, unitPrice: 1, lockedFreeUnits: 1 }).freeUnits, 1);
});

test('rule 41 — releaseAllowance returns a removed line\'s share to the pool, with its worth', () => {
  assert.deepEqual(releaseAllowance({ freeUnits: 2, unitPrice: 6 }), { returned: 2, amount: 12 });
  assert.deepEqual(releaseAllowance({ freeUnits: 0, unitPrice: 6 }), { returned: 0, amount: 0 });
  assert.deepEqual(releaseAllowance({}), { returned: 0, amount: 0 });
  assert.deepEqual(releaseAllowance(null), { returned: 0, amount: 0 });
});

test('rule 41 — consume then release is a round trip on the pool', () => {
  const used = consumeAllowance({ granted: 3, isDirect: true, billedUnits: 2, unitPrice: 4 });
  assert.equal(releaseAllowance({ freeUnits: used.used, unitPrice: 4 }).returned, used.used);
});

test('rule 41 — free minutes: the hour of the lodging comes off the billed hours, once, never below zero', () => {
  assert.equal(applyPerHourFreeMinutes(3, 60), 2);
  assert.equal(applyPerHourFreeMinutes(0.5, 60), 0);
  assert.equal(applyPerHourFreeMinutes(2, 0), 2);
  assert.equal(applyPerHourFreeMinutes(2, undefined), 2);
  assert.equal(normalizeBilledUnits('x'), 0);
  assert.equal(normalizeBilledUnits(-3), 0);
});

const ledger = (over) => createFreeUnitsLedger({
  lockedTariff: null, optionsById: new Map([[7, { freeUnits: 2 }]]), lockedOptionsById: new Map(), isDirectBooking: true, ...over,
});

test('rule 41 — the ledger: no snapshot means a sale made now, granted at the catalogue, nothing consumed yet', () => {
  const stay = ledger();
  assert.equal(stay.grantedFreeUnitsFor(7), 2);
  assert.equal(stay.grantedFreeUnitsFor(99), 0);
  assert.equal(stay.consumedFreeUnitsFor(7), 0);
});

test('rule 41 — the ledger: the granted map of a sold stay survives a raised catalogue; an option absent from it gets today\'s', () => {
  const stay = ledger({ lockedTariff: { grantedFreeUnitsByOption: { 7: 1 } }, optionsById: new Map([[7, { freeUnits: 3 }], [8, { freeUnits: 4 }]]) });
  assert.equal(stay.grantedFreeUnitsFor(7), 1);
  assert.equal(stay.grantedFreeUnitsFor(8), 4);
});

test('rule 41 — the ledger: a snapshot older than the grant map stands in for it, and an option new to the stay gets the catalogue', () => {
  const stay = ledger({
    lockedTariff: { freeUnitsByOption: { 7: 2 } },
    optionsById: new Map([[7, { freeUnits: 3 }], [8, { freeUnits: 4 }], [9, { freeUnits: 5 }]]),
    lockedOptionsById: new Map([[8, {}]]),
  });
  assert.equal(stay.grantedFreeUnitsFor(7), 2);
  assert.equal(stay.grantedFreeUnitsFor(8), 0);
  assert.equal(stay.grantedFreeUnitsFor(9), 5);
});

test('rule 41 — the ledger: what a stored line is net of counts only for a sold grant or an own-channel stay', () => {
  const tariff = { freeUnitsByOption: { 7: 2 } };
  assert.equal(ledger({ lockedTariff: tariff }).consumedFreeUnitsFor(7), 2);
  assert.equal(ledger({ lockedTariff: tariff, isDirectBooking: false }).consumedFreeUnitsFor(7), 0);
  assert.equal(ledger({ lockedTariff: { ...tariff, grantedFreeUnitsByOption: { 7: 2 } }, isDirectBooking: false }).consumedFreeUnitsFor(7), 2);
});

test('rule 41 — the ledger exposes the two maps the engine stamps back into the snapshot', () => {
  const stay = ledger({ lockedTariff: { grantedFreeUnitsByOption: { 7: 1 }, freeUnitsByOption: { 7: 1 } } });
  assert.deepEqual(stay.soldGrantMap, { 7: 1 });
  assert.deepEqual(stay.consumedMap, { 7: 1 });
  assert.equal(ledger().soldGrantMap, null);
});
