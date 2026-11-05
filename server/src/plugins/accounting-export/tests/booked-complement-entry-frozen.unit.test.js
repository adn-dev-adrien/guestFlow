// specs/accounting-books-the-money-collected.md rule 16 (audit R22-6a, 2026-11-05) — a collected arrival complement
// keeps the entry it was booked on: `reservations.complementPaidSplit`, stamped at the flip on every path. What the stay
// gains afterwards goes to the end-of-stay entry (D9), and a cancelled stay gives back exactly what the entries hold.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, NO_ACOMPTE, WITH_ACOMPTE, PLATFORM, S, C, D, forced, free, fiche, put, pay, cancel, register, offered, keyOf, giveAll, net, csv, entry, rowOf, mark, ficheView,
} = require('./journalFixture');
const { computeComplementPaidSplit, stampComplementPaidSplit } = require('../../../utils/complementPaidSplit');
const { buildPerLineData } = require('../../../utils/storedMoneySplit');

const ACCOMMODATION = '70600000';
const PRESTATION = '70600010';
const TAX = '46710000';

test('tax on the complement: 24,80 € booked, one adult more, the entry does not move (was 4,80 → 7,20 of tax, 18,18 → 16 of revenue)', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { touristTaxInComplement: 1, customOptions: [forced(20)] });
  pay(stay.id, S, C);
  assert.equal(rowOf(stay.id).complementAmount, 24.8);
  const before = csv();
  assert.equal(entry(stay.id, 'complement')[TAX], 4.8);
  await put(stay, { adults: 3 });
  assert.equal(csv(), before);
  assert.equal(entry(stay.id, 'complement')[PRESTATION], 18.18);
});

test('tax on the solde, a complement of 20 €: it never gains the tax that rose', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  pay(stay.id, S, C);
  const before = csv();
  await put(stay, { adults: 3 });
  assert.equal(csv(), before);
  assert.equal(entry(stay.id, 'complement')[TAX], undefined);
});

test('a direct gap complement stays on the accommodation at the second change of party', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct');
  pay(stay.id, S);
  await put(stay, { adults: 3 });
  assert.equal(rowOf(stay.id).complementAmount, 42.4);
  pay(stay.id, C);
  assert.equal(entry(stay.id, 'complement')[ACCOMMODATION], 36.36);
  const before = csv();
  await put(stay, { adults: 4 });
  assert.equal(csv(), before);
  assert.equal(ficheView(stay.id).ledger.remaining, 42.4, 'what rose is claimed at the end of stay');
});

test('p8 residue — solde and complement paid, adults added, cancelled, everything given back: every account at 0', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [free(142, 'Libre'), forced(20)] });
  pay(stay.id, S, C);
  await put(stay, { adults: 4 });
  await cancel(stay.id);
  assert.deepEqual(offered(stay.id), { accommodation: 600, 'custom:libre': 142, 'custom:forcée': 20, touristTax: 4.8 });
  giveAll(stay.id);
  assert.deepEqual(net(stay.id), {});
  assert.equal(register(stay.id).collectedTtc, 0);
});

test('a forced line lowered after the complement: the entry holds, the register offers what it collected', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(50)] });
  pay(stay.id, S, C);
  const before = csv();
  await put(stay, { customOptions: [forced(25)] });
  assert.equal(csv(), before);
  await cancel(stay.id);
  assert.equal(offered(stay.id)[keyOf(stay.id, 'Forcée')], 50);
  giveAll(stay.id);
  assert.deepEqual(net(stay.id), {});
});

test('a forced line removed from a paid complement: same entry, 20 € still offered on it after the cancellation', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  pay(stay.id, S, C);
  const before = csv();
  await put(stay, { customOptions: [] });
  assert.equal(csv(), before);
  await cancel(stay.id);
  assert.equal(offered(stay.id)['custom:forcée'], 20);
  giveAll(stay.id);
  assert.deepEqual(net(stay.id), {});
});

test('the stored split is the entry the live path books at the flip: same bytes with the column emptied', async () => {
  const cases = [
    fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] }),
    fiche(NO_ACOMPTE, 'direct', { touristTaxInComplement: 1, customOptions: [forced(20)] }),
    fiche(WITH_ACOMPTE, 'direct', { customOptions: [forced(50), free(100)] }),
    fiche(NO_ACOMPTE, PLATFORM.owner, { platformGrossAmount: 600, customOptions: [forced(20)] }),
  ];
  for (const stay of cases) {
    if (rowOf(stay.id).depositAmount > 0) pay(stay.id, D);
    pay(stay.id, S, C);
    const withSplit = csv();
    const stored = rowOf(stay.id).complementPaidSplit;
    assert.ok(stored, 'stamped');
    db.prepare('UPDATE reservations SET complementPaidSplit = NULL WHERE id = ?').run(stay.id);
    assert.equal(csv(), withSplit);
    db.prepare('UPDATE reservations SET complementPaidSplit = ? WHERE id = ?').run(stored, stay.id);
  }
});

test('un-ticking the complement clears the split; a new tick stamps what the stay holds then', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  pay(stay.id, S, C);
  assert.ok(rowOf(stay.id).complementPaidSplit);
  assert.equal(mark(stay.id, { complementPaid: false }).statusCode, 200);
  assert.equal(rowOf(stay.id).complementPaidSplit, null);
  await put(stay, { adults: 3 });
  assert.equal(rowOf(stay.id).complementAmount, 62.4);
  pay(stay.id, C);
  const booked = entry(stay.id, 'complement');
  assert.equal(booked[PRESTATION], 18.18);
  assert.equal(booked[ACCOMMODATION], 36.36);
  assert.equal(booked[TAX], 2.4);
});

test('an amount adjusted after the flip keeps the adjusted path; a split that no longer adds up is not read', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  pay(stay.id, S, C);
  await put(stay, { complementAmountOverride: 15 });
  assert.equal(rowOf(stay.id).complementAmount, 15);
  const booked = entry(stay.id, 'complement');
  assert.equal(Math.round((booked[PRESTATION] + (booked['44571100'] || 0)) * 100) / 100, 15);
});

test('fuzz residue — re-ticked with the tax in it: the forced line holds its share, the give-back nets to 0', async () => {
  const stay = fiche(WITH_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  pay(stay.id, S, C);
  await put(stay, { adults: 4 });
  pay(stay.id, D);
  assert.equal(mark(stay.id, { complementPaid: false }).statusCode, 200);
  pay(stay.id, C);
  const split = JSON.parse(rowOf(stay.id).complementPaidSplit);
  assert.deepEqual(split.lines.map((line) => line.cents), [split.optionsCents]);
  await cancel(stay.id);
  giveAll(stay.id);
  assert.deepEqual(net(stay.id), {});
  assert.equal(register(stay.id).collectedTtc, 0);
});

test('fuzz residue — a solde ticked before its acompte, a guest added, the complement: accommodation, nets to 0', async () => {
  const stay = fiche(WITH_ACOMPTE, 'direct', { customOptions: [free(35)] });
  pay(stay.id, S);
  await put(stay, { adults: 3 });
  assert.equal(rowOf(stay.id).complementAmount, 42.4);
  pay(stay.id, C);
  assert.equal(entry(stay.id, 'complement')[ACCOMMODATION], 36.36);
  await cancel(stay.id);
  giveAll(stay.id);
  assert.deepEqual(net(stay.id), {});
  assert.equal(register(stay.id).collectedTtc, 0);
});

test('the pure split: a nothing complement stores nothing; an adjusted one stores nothing', () => {
  const stay = fiche(NO_ACOMPTE, 'direct');
  assert.equal(computeComplementPaidSplit(db, stay.id), null);
  stampComplementPaidSplit(db, stay.id);
  assert.equal(rowOf(stay.id).complementPaidSplit, null);
  assert.ok(buildPerLineData(db, rowOf(stay.id)));
});
