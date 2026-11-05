// specs/accounting-books-the-money-collected.md rule 17 (D11, audit R22-6b, 2026-11-05) — removing a paid line does not
// rewrite a booked entry: its contribs stay on the stay per bucket (`reservations.removedLineContribs`), read by the
// export and by collectedByLine; a cancelled stay offers the removed line for what it collected.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, NO_ACOMPTE, WITH_ACOMPTE, S, D, free, fiche, put, pay, cancel, register, offered, giveAll, net, csv, entry, rowOf, mark,
} = require('./journalFixture');
const { parseRemovedLineContribs } = require('../../../utils/removedLineContribs');
const reservationsModel = require('../../../models/reservationsModel');

const PRESTATION = '70600010';
const ACCOMMODATION = '70600000';
const RESOURCE = '70601000';

db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (50, 'Panier', 'per_stay', 100)").run();
db.prepare("INSERT INTO resources (id, name, quantity, priceType, price) VALUES (60, 'Bain', 1, 'per_stay', 80)").run();
for (const property of [NO_ACOMPTE, WITH_ACOMPTE]) {
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (?, 50)').run(property);
  db.prepare('INSERT INTO resource_properties (resourceId, propertyId) VALUES (60, ?)').run(property);
}
const option = { options: [{ optionId: 50, quantity: 1 }], selectedOptions: [{ optionId: 50, quantity: 1 }] };
const noOption = { options: [], selectedOptions: [] };

test('solde entry: a paid free line removed, 70600010 keeps 129,09 €, 70600000 keeps 545,45 €, byte-identical', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [free(142)] });
  pay(stay.id, S);
  const booked = entry(stay.id, 'balance');
  assert.equal(booked[PRESTATION], 129.09);
  const before = csv();
  await put(stay, { customOptions: [] });
  assert.equal(csv(), before);
  assert.deepEqual(entry(stay.id, 'balance'), booked);
  const [record] = parseRemovedLineContribs(rowOf(stay.id).removedLineContribs);
  assert.deepEqual(record, { key: 'custom:libre', label: 'Libre', bucket: 'options', acompteContribTtc: null, soldeContribTtc: 142 });
});

test('acompte and solde entries: both hold, on an option line too', async () => {
  const stay = fiche(WITH_ACOMPTE, 'direct', { ...option });
  pay(stay.id, D, S);
  const before = csv();
  await put(stay, noOption);
  assert.equal(csv(), before);
  const [record] = parseRemovedLineContribs(rowOf(stay.id).removedLineContribs);
  assert.equal(record.acompteContribTtc + record.soldeContribTtc, 100);
  assert.equal(record.bucket, 'options');
});

test('a resource line: the bucket says resources, 70601000 holds', async () => {
  const resources = [{ resourceId: 60, quantity: 1 }];
  const stay = fiche(NO_ACOMPTE, 'direct', { selectedResources: resources, resources });
  pay(stay.id, S);
  const booked = entry(stay.id, 'balance');
  assert.ok(booked[RESOURCE] > 0);
  await put(stay, { selectedResources: [], resources: [] });
  assert.deepEqual(entry(stay.id, 'balance'), booked);
  assert.equal(parseRemovedLineContribs(rowOf(stay.id).removedLineContribs)[0].bucket, 'resources');
});

test('cancelled: the removed line is offered for what it collected, labelled, and nets to 0 (the auditor left it unverified)', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [free(142)] });
  pay(stay.id, S);
  await put(stay, { customOptions: [] });
  await cancel(stay.id);
  const line = register(stay.id).refundableLines.find((l) => l.key === 'custom:libre');
  assert.equal(line.label, 'Libre');
  assert.equal(line.refundableTtc, 142);
  giveAll(stay.id);
  assert.deepEqual(net(stay.id), {});
  assert.equal(register(stay.id).collectedTtc, 0);
});

test('acompte, then line removed, cancelled: the avoir reads the contribs kept on the stay, nets to 0', async () => {
  const stay = fiche(WITH_ACOMPTE, 'direct', { customOptions: [free(100)] });
  pay(stay.id, D);
  const before = csv();
  await put(stay, { customOptions: [] });
  assert.equal(csv(), before);
  await cancel(stay.id);
  giveAll(stay.id);
  assert.deepEqual(net(stay.id), {});
});

test('the model readers count them: the captured sums still describe the entries', async () => {
  const stay = fiche(WITH_ACOMPTE, 'direct', { customOptions: [free(100)] });
  pay(stay.id, D, S);
  const captured = reservationsModel.capturedScheduleContribs(stay.id);
  const buckets = reservationsModel.soldeContribBuckets(stay.id);
  await put(stay, { customOptions: [] });
  assert.deepEqual(reservationsModel.capturedScheduleContribs(stay.id), captured);
  assert.deepEqual(reservationsModel.soldeContribBuckets(stay.id), buckets);
});

test('a trop-perçu reads the poste the money came from', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [free(142)] });
  pay(stay.id, S);
  await put(stay, { customOptions: [] });
  const poste = reservationsModel.capturedScheduleContribsByPoste(stay.id).balance;
  assert.equal(poste.options, 142);
});

test('un-ticking the solde drops the bucket it held; a line never paid records nothing', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [free(142), free(10, 'Autre')] });
  await put(stay, { customOptions: [free(142)] });
  assert.equal(rowOf(stay.id).removedLineContribs, null);
  pay(stay.id, S);
  await put(stay, { customOptions: [] });
  assert.ok(rowOf(stay.id).removedLineContribs);
  assert.equal(mark(stay.id, { balancePaid: false }).statusCode, 200);
  assert.equal(rowOf(stay.id).removedLineContribs, null);
});

test('a line renamed keeps its contrib on the new name: no phantom removal', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [free(142)] });
  pay(stay.id, S);
  const line = db.prepare('SELECT id FROM reservation_custom_options WHERE reservationId = ?').get(stay.id);
  const before = csv();
  await put(stay, { customOptions: [{ ...free(142, 'Renommée'), customOptionId: line.id, id: line.id }, free(5, 'Ajout', null)] });
  assert.equal(rowOf(stay.id).removedLineContribs, null);
  assert.equal(csv(), before);
});

test('a line removed then added back: the booked entry holds, what it collected reads once per key', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [free(142)] });
  pay(stay.id, S);
  const before = csv();
  await put(stay, { customOptions: [] });
  await put(stay, { customOptions: [free(142)] });
  assert.equal(csv(), before);
  await cancel(stay.id);
  assert.equal(offered(stay.id)['custom:libre'], 142);
  giveAll(stay.id);
  assert.deepEqual(net(stay.id), {});
});

test('the accommodation account stays untouched when the line goes', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [free(142)] });
  pay(stay.id, S);
  const accommodation = entry(stay.id, 'balance')[ACCOMMODATION];
  await put(stay, { customOptions: [] });
  assert.equal(entry(stay.id, 'balance')[ACCOMMODATION], accommodation);
});

// Audit R23-S3 — the lines of the record no test held; the two scenarios are the auditor's probes.
const { collectedLinesGone } = require('../../../utils/refunds');

test('a second removal of one key adds up: paid by the acompte, removed, re-added, paid by the solde, removed', async () => {
  const stay = fiche(WITH_ACOMPTE, 'direct', { customOptions: [free(142)] });
  pay(stay.id, D);
  const fromAcompte = db.prepare('SELECT acompteContribTtc AS c FROM reservation_custom_options WHERE reservationId = ?').get(stay.id).c;
  await put(stay, { customOptions: [] });
  await put(stay, { customOptions: [free(142)] });
  pay(stay.id, S);
  const fromSolde = db.prepare('SELECT soldeContribTtc AS c FROM reservation_custom_options WHERE reservationId = ?').get(stay.id).c;
  await put(stay, { customOptions: [] });
  const records = parseRemovedLineContribs(rowOf(stay.id).removedLineContribs);
  assert.equal(records.length, 1);
  assert.equal(records[0].acompteContribTtc, fromAcompte);
  assert.equal(records[0].soldeContribTtc, fromSolde);
  assert.ok(fromAcompte > 0 && fromSolde > 0);
});

test('un-ticking the acompte clears its bucket only: the solde’s stays', async () => {
  const stay = fiche(WITH_ACOMPTE, 'direct', { customOptions: [free(142)] });
  pay(stay.id, D, S);
  const held = db.prepare('SELECT soldeContribTtc AS c FROM reservation_custom_options WHERE reservationId = ?').get(stay.id).c;
  assert.ok(held > 0);
  await put(stay, { customOptions: [] });
  pay(stay.id, { depositPaid: false });
  const [record] = parseRemovedLineContribs(rowOf(stay.id).removedLineContribs);
  assert.equal(record.acompteContribTtc, null);
  assert.equal(record.soldeContribTtc, held);
});

test('a gone line paid in the caisse interne is offered for that money', () => {
  const reservation = { removedLineContribs: JSON.stringify([{ key: 'custom:libre', label: 'Libre', bucket: 'options', acompteContribTtc: null, soldeContribTtc: 30 }]) };
  const gone = collectedLinesGone({ reservation, collected: { 'custom:libre': 0 }, cashCollected: { 'custom:libre': 30 } });
  assert.deepEqual(gone, [{ key: 'custom:libre', label: 'Libre', bucket: 'options', collectedTtc: 30 }]);
});
