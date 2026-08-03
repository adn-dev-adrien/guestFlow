// Arrival / departure SAS → reservation history. See specs/arrival-departure-sas.md §3.7.

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildSasSnapshot, computeSasChanges } = require('../utils/sasAudit');

const baseRow = {
  cautionReceived: 0, cautionReturned: 0,
  complementAmount: 30, complementPaid: 0, complementDeferredToCheckout: 0,
  endOfStayComplementAmount: 0, endOfStayComplementPaid: 0, endOfStayComplementDetail: null,
  breakfastCoffee: 0, breakfastTea: 0, breakfastChocolate: 0, breakfastMilk: 0,
  breakfastPastries: 0, breakfastCereals: 0, breakfastBread: 0,
  breakfastTime: null, breakfastNote: null, departureHandoverNote: null,
  extinguisherSealOkAtArrival: null, extinguisherSealOkAtDeparture: null,
};

const snap = (row = {}, extras = {}) => buildSasSnapshot({ ...baseRow, ...row }, extras);

test('no change → no history entry', () => {
  assert.deepEqual(computeSasChanges(snap(), snap()), []);
});

test('arrival: caution, upsells and complement land in the diff with French texts', () => {
  const before = snap();
  const after = snap(
    { cautionReceived: 1, complementAmount: 94, complementDeferredToCheckout: 1 },
    { cleaningPresent: true, bathLinenPresent: true },
  );
  const changes = computeSasChanges(before, after);
  const byField = Object.fromEntries(changes.map((c) => [c.field, c]));

  assert.equal(byField.cautionReceived.label, 'Caution reçue');
  assert.deepEqual([byField.cautionReceived.fromText, byField.cautionReceived.toText], ['non', 'oui']);
  assert.deepEqual([byField.cleaningOption.fromText, byField.cleaningOption.toText], ['non pris', 'pris']);
  assert.deepEqual([byField.bathLinenOption.fromText, byField.bathLinenOption.toText], ['non pris', 'pris']);
  assert.deepEqual([byField.complementAmount.fromText, byField.complementAmount.toText], ['30 €', '94 €']);
  assert.equal(byField.complementDeferredToCheckout.toText, 'oui');
});

test('breakfast is summarised, and only its non-zero items show', () => {
  const changes = computeSasChanges(
    snap(),
    snap({ breakfastCoffee: 2, breakfastBread: 1.5, breakfastTime: '09:00' }),
  );
  const byField = Object.fromEntries(changes.map((c) => [c.field, c]));
  assert.equal(byField.breakfast.fromText, 'aucun');
  assert.equal(byField.breakfast.toText, '2 café, 1,5 baguette(s)');
  assert.equal(byField.breakfastTime.toText, '09:00');
  assert.equal(byField.breakfastNote, undefined, 'an untouched field never appears');
});

test('departure: billed lines, extinguisher and caution return are recorded', () => {
  const before = snap();
  const after = snap(
    {
      cautionReturned: 1, extinguisherSealOkAtDeparture: 0,
      endOfStayComplementAmount: 48,
      endOfStayComplementDetail: JSON.stringify([{ label: 'Serviette de bain', amount: 16, qty: 2 }, { label: 'Plomb manquant', amount: 32 }]),
    },
    { endOfStayLines: [{ label: 'Serviette de bain', amount: 16, qty: 2 }, { label: 'Plomb manquant', amount: 32 }] },
  );
  const byField = Object.fromEntries(computeSasChanges(before, after).map((c) => [c.field, c]));

  assert.equal(byField.cautionReturned.toText, 'oui');
  assert.equal(byField.extinguisherSealOkAtDeparture.toText, 'plomb absent');
  assert.equal(byField.endOfStayComplementAmount.toText, '48 €');
  assert.equal(byField.endOfStayComplementDetail.toText, 'Serviette de bain ×2 (16 €), Plomb manquant (32 €)');
});

test('linen elements billed at check-in are listed', () => {
  const changes = computeSasChanges(
    snap(),
    snap({}, { linenLines: [{ description: "Taie d'oreiller", amount: 5 }] }),
  );
  const line = changes.find((c) => c.field === 'linenItems');
  assert.equal(line.label, 'Éléments de linge facturés');
  assert.deepEqual([line.fromText, line.toText], ['aucun', "Taie d'oreiller (5 €)"]);
});

test('a removed upsell reads « pris → non pris » (the SAS undo is traceable too)', () => {
  const changes = computeSasChanges(
    snap({}, { bathLinenPresent: true }),
    snap({}, { bathLinenPresent: false }),
  );
  const line = changes.find((c) => c.field === 'bathLinenOption');
  assert.deepEqual([line.fromText, line.toText], ['pris', 'non pris']);
});
