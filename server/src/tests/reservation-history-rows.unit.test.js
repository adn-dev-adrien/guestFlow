/**
 * specs/reservation-history-granular-diff.md — read side of « Historique des modifications ».
 * The stored diff must come out as one row per changed thing, values written in French.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildHistoryRows, formatHistoryFieldValue } = require('../utils/reservationAudit');

const NAMES = {
  optionNames: { 6: 'Petit-déjeuner', 8: 'Linge de lit' },
  resourceNames: { 3: 'Lit parapluie' },
  propertyNames: { 3: 'Le Nid', 5: 'La Grange' },
  clientNames: { 1: 'Jean Dupont' },
};

const sig = (from, to) => ({ field: 'optionsSignature', label: 'Options', from, to });

test('options: added / removed / changed lines, untouched lines produce no row', () => {
  const { changes } = buildHistoryRows([sig(
    '6:1:8.00:c0|8:3:22.50:c1',
    '6:2:16.00:c0|3000000:1:12.00:c0',
  )], NAMES);

  assert.deepEqual(changes.map((r) => [r.label, r.kind, r.fromText, r.toText]), [
    ['Petit-déjeuner', 'changed', '8 €', '×2 : 16 €'],
    ['Linge de lit', 'removed', '×3 : 22,50 € (compl.)', null],
    ['Option personnalisée', 'added', null, '12 €'],
  ]);
  assert.equal(changes[0].group, 'Options');
});

test('options: a line identical on both sides is dropped entirely', () => {
  const { changes } = buildHistoryRows([sig('6:1:8.00:c0', '6:1:8.00:c0|8:1:14.00:c0')], NAMES);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].label, 'Linge de lit');
  assert.equal(changes[0].kind, 'added');
});

test('options: an empty signature on either side is not a fake « aucune » line', () => {
  const { changes } = buildHistoryRows([sig('', '6:1:8.00:c0')], NAMES);
  assert.deepEqual(changes.map((r) => [r.label, r.kind, r.fromText, r.toText]), [
    ['Petit-déjeuner', 'added', null, '8 €'],
  ]);
});

test('resources: the offered flag rides in the value text and unknown ids fall back to #id', () => {
  const { changes } = buildHistoryRows([{
    field: 'resourcesSignature',
    label: 'Ressources',
    from: '3:1:20.00:0:c0',
    to: '3:1:20.00:1:c0|9:2:30.00:0:c1',
  }], NAMES);

  assert.deepEqual(changes.map((r) => [r.group, r.label, r.kind, r.fromText, r.toText]), [
    ['Ressources', 'Lit parapluie', 'changed', '20 €', '20 € (offert)'],
    ['Ressources', 'Ressource #9', 'added', null, '×2 : 30 € (compl.)'],
  ]);
});

test('plain fields are formatted per type: names, Oui/Non, €, JJ/MM/AAAA, %', () => {
  const { changes } = buildHistoryRows([
    { field: 'propertyId', label: 'Logement', from: 3, to: 5 },
    { field: 'clientId', label: 'Client', from: null, to: 1 },
    { field: 'startDate', label: 'Date arrivée', from: '2026-07-09', to: '2026-07-12' },
    { field: 'cautionReceived', label: 'Caution reçue', from: 0, to: 1 },
    { field: 'discountPercent', label: 'Réduction (%)', from: 0, to: 10 },
    { field: 'cautionAmount', label: 'Caution', from: 0, to: 500 },
    { field: 'notes', label: 'Notes', from: null, to: 'Arrivée tardive' },
  ], NAMES);

  assert.deepEqual(changes.map((r) => [r.label, r.fromText, r.toText]), [
    ['Logement', 'Le Nid', 'La Grange'],
    ['Client', 'vide', 'Jean Dupont'],
    ['Date arrivée', '09/07/2026', '12/07/2026'],
    ['Caution reçue', 'Non', 'Oui'],
    ['Réduction (%)', '0 %', '10 %'],
    ['Caution', '0 €', '500 €'],
    ['Notes', 'vide', 'Arrivée tardive'],
  ]);
  assert.equal(changes.every((r) => r.kind === 'changed' && r.group === null), true);
});

test('formatHistoryFieldValue: deleted property/client ids degrade to #id', () => {
  assert.equal(formatHistoryFieldValue('propertyId', 42, NAMES), '#42');
  assert.equal(formatHistoryFieldValue('clientId', 42, NAMES), '#42');
  assert.equal(formatHistoryFieldValue('finalPrice', 19.5, NAMES), '19,50 €');
  assert.equal(formatHistoryFieldValue('depositDueDate', null, NAMES), 'vide');
});

test('engine recalculations are split into `derived`, the edit stays in `changes`', () => {
  const { changes, derived } = buildHistoryRows([
    { field: 'finalPrice', label: 'Prix final', from: 497, to: 547 },
    { field: 'depositAmount', label: 'Acompte', from: 149.1, to: 164.1 },
    sig('', '6:1:50.00:c0'),
  ], NAMES);

  assert.deepEqual(changes.map((r) => r.label), ['Petit-déjeuner']);
  assert.deepEqual(derived.map((r) => [r.label, r.fromText, r.toText]), [
    ['Prix final', '497 €', '547 €'],
    ['Acompte', '149,10 €', '164,10 €'],
  ]);
});

test('an entry made only of recalculations renders as the main list (never an empty entry)', () => {
  const { changes, derived } = buildHistoryRows([
    { field: 'finalPrice', label: 'Prix final', from: 100, to: 120 },
  ], NAMES);
  assert.deepEqual(changes.map((r) => r.label), ['Prix final']);
  assert.deepEqual(derived, []);
});

test('rows that already carry fromText/toText (SAS, iCal lock) pass through untouched', () => {
  const { changes } = buildHistoryRows([
    { field: 'cautionReceived', label: 'Caution reçue', fromText: 'non', toText: 'oui' },
    { field: 'icalSyncLocked', label: 'Synchronisation iCal', from: 'Active', to: 'Verrouillée après modification manuelle' },
  ], NAMES);

  assert.deepEqual(changes.map((r) => [r.label, r.fromText, r.toText]), [
    ['Caution reçue', 'non', 'oui'],
    ['Synchronisation iCal', 'Active', 'Verrouillée après modification manuelle'],
  ]);
});

test('malformed input never throws', () => {
  assert.deepEqual(buildHistoryRows(null), { changes: [], derived: [] });
  assert.deepEqual(buildHistoryRows([null, {}, 'x']), { changes: [], derived: [] });
});
