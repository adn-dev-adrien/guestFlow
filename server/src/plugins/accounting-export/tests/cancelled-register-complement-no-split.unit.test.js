// specs/reservation-refunds.md rule 49, reading of 2026-11-05 (audit R22-2) — a complement collected before
// `complementPaidSplit` existed has none: the register reads it from the stay. Every production complement of today is in
// that case, so the readings stamped stays never reach are pinned here: the auditor's scenarios with the split NULLed before
// the cancellation.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, respond, ADMIN, NO_ACOMPTE, WITH_ACOMPTE, PLATFORM, S, C, D, TODAY, forced, free, fiche, put, pay, cancel, register, offered, giveAll, net, rowOf, entry,
} = require('./journalFixture');
const installmentsController = require('../../../controllers/installmentsController');
const reservationsModel = require('../../../models/reservationsModel');
const { collectedByLine } = require('../../../utils/refunds');

const ACCOMMODATION = 'accommodation';
const TAX = 'touristTax';
const LINE = 'custom:forcée';

const dropSplit = (id) => db.prepare('UPDATE reservations SET complementPaidSplit = NULL WHERE id = ?').run(id);
const dropContribs = (id) => {
  db.prepare(`UPDATE reservations SET accommodationAcompteContribTtc = NULL, touristTaxAcompteContribTtc = NULL,
    accommodationSoldeContribTtc = NULL, touristTaxSoldeContribTtc = NULL WHERE id = ?`).run(id);
  db.prepare('UPDATE reservation_custom_options SET acompteContribTtc = NULL, soldeContribTtc = NULL WHERE reservationId = ?').run(id);
};

// The reading itself, ahead of the register's budget, which hides most of it.
const reading = (id) => {
  const stay = reservationsModel.getByIdWithDetails(id);
  return collectedByLine({ reservation: stay, options: stay.options, resources: stay.resources });
};

async function givenBack(id) {
  dropSplit(id);
  await cancel(id);
  const lines = offered(id);
  giveAll(id);
  assert.deepEqual(net(id), {}, `offered ${JSON.stringify(lines)}`);
  assert.equal(register(id).collectedTtc, 0);
  return lines;
}

test('A — no acompte, tax on the solde, forced 50 €: the line, not its tax', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { depositDisabled: 1, customOptions: [forced(50)] });
  pay(stay.id, C);
  assert.deepEqual(await givenBack(stay.id), { [LINE]: 50 });
});

test('A2 — a free line never collected offers nothing; the forced one offers 50 €', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { depositDisabled: 1, customOptions: [forced(50), free(100)] });
  pay(stay.id, C);
  dropSplit(stay.id);
  assert.equal(reading(stay.id)['custom:libre'], 0);
  assert.deepEqual(await givenBack(stay.id), { [LINE]: 50 });
});

test('K1 — acompte, forced and free lines: the forced line keeps its 50 €, no tax', async () => {
  const stay = fiche(WITH_ACOMPTE, 'direct', { customOptions: [forced(50), free(100)] });
  pay(stay.id, D, C);
  const collected = Math.round((rowOf(stay.id).depositAmount + 50) * 100) / 100;
  const lines = await givenBack(stay.id);
  assert.equal(lines[LINE], 50);
  assert.equal(lines[TAX], undefined);
  assert.equal(Math.round(Object.values(lines).reduce((sum, v) => sum + v, 0) * 100) / 100, collected);
});

test('K2 — acompte, tax in the complement: the whole tax, the forced line', async () => {
  const stay = fiche(WITH_ACOMPTE, 'direct', { touristTaxInComplement: 1, customOptions: [forced(50), free(100)] });
  pay(stay.id, D, C);
  const lines = await givenBack(stay.id);
  assert.equal(lines[TAX], 4.8);
  assert.equal(lines[LINE], 50);
});

test('C — no acompte, tax in the complement: the tax and the line', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { depositDisabled: 1, touristTaxInComplement: 1, customOptions: [forced(50)] });
  pay(stay.id, C);
  assert.deepEqual(await givenBack(stay.id), { [TAX]: 4.8, [LINE]: 50 });
});

test('D — own channel reversed, added guest, complement alone: supplement and added tax', async () => {
  const stay = fiche(NO_ACOMPTE, PLATFORM.ownReversed, { platformGrossAmount: 600, depositDisabled: 1 });
  await put(stay, { adults: 3 });
  pay(stay.id, C);
  assert.deepEqual(await givenBack(stay.id), { [ACCOMMODATION]: 40, [TAX]: 2.4 });
});

test('K5 — the same with an acompte paid: its contribs describe it, the complement reads the same', async () => {
  const stay = fiche(WITH_ACOMPTE, PLATFORM.ownReversed, { platformGrossAmount: 600 });
  await put(stay, { adults: 3 });
  const acompte = rowOf(stay.id).depositAmount;
  pay(stay.id, D, C);
  dropSplit(stay.id);
  assert.equal(reading(stay.id)[ACCOMMODATION], Math.round((acompte + 40) * 100) / 100);
  assert.deepEqual(await givenBack(stay.id), { [ACCOMMODATION]: Math.round((acompte + 40) * 100) / 100, [TAX]: 2.4 });
});

test('a line that grew after the solde: the complement collected its growth', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [free(100)] });
  pay(stay.id, S);
  await put(stay, { customOptions: [free(150)] });
  assert.equal(rowOf(stay.id).complementAmount, 50);
  pay(stay.id, C);
  const lines = await givenBack(stay.id);
  assert.equal(lines['custom:libre'], 150);
  assert.equal(lines[TAX], 4.8);
});

test('solde and complement with no contribs either: the solde\'s buckets, the whole tax, the added guest on the accommodation', async () => {
  const stay = fiche(NO_ACOMPTE, PLATFORM.ownReversed, { platformGrossAmount: 600, depositDisabled: 1 });
  await put(stay, { adults: 3 });
  pay(stay.id, S, C);
  dropContribs(stay.id);
  assert.deepEqual(await givenBack(stay.id), { [ACCOMMODATION]: 635.2, [TAX]: 7.2 });
});

test('a plan holds the lines it collected: a free line paid by the installments is offered, unlike a stay with no pre-arrival money', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(50), free(100)] });
  const put2 = respond();
  await installmentsController.put({ params: { id: stay.id }, body: { count: 2 }, user: ADMIN }, put2);
  assert.equal(put2.statusCode, 200, JSON.stringify(put2.body));
  for (const installment of db.prepare('SELECT id FROM reservation_installments WHERE reservationId = ? ORDER BY number').all(stay.id)) {
    const res = respond();
    await installmentsController.markPaid({ params: { id: stay.id, installmentId: installment.id }, body: { paidDate: TODAY, method: 'transfer' }, user: ADMIN }, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  }
  pay(stay.id, C);
  const lines = await givenBack(stay.id);
  assert.equal(lines['custom:libre'], 100);
  assert.equal(lines[LINE], 50);
});

test('audit R23-S3 — a line the complement’s split names, gone from the fiche, stays read on the no-contrib path', () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(50)] });
  pay(stay.id, S, C);
  assert.equal(JSON.parse(rowOf(stay.id).complementPaidSplit).lines[0].key, LINE);
  dropContribs(stay.id);
  db.prepare('DELETE FROM reservation_custom_options WHERE reservationId = ?').run(stay.id);
  assert.equal(reading(stay.id)[LINE], 50);
});

test('audit R23-S3 — an adjusted complement: no stamp, the export follows the stored allocation', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  pay(stay.id, S);
  await put(stay, { complementAmountOverride: 80 });
  pay(stay.id, C);
  assert.equal(rowOf(stay.id).complementPaidSplit, null);
  const allocation = JSON.parse(rowOf(stay.id).complementAllocation);
  const booked = entry(stay.id, 'complement');
  assert.equal(Math.round((allocation.accommodation + allocation.options + allocation.resources + (allocation.tax || 0)) * 100) / 100, 80);
  assert.ok(Object.keys(booked).length > 0);
  assert.equal(booked['70600000'] || 0, Math.round((allocation.accommodation / 1.1) * 100) / 100);
  assert.equal(booked['70600010'] || 0, Math.round((allocation.options / 1.1) * 100) / 100);
});
