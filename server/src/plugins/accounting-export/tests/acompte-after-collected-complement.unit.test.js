// specs/reservation-payment-ledger.md rule 46, reading of 2026-11-05 (R22 verification) — an acompte ticked after a
// collected complement, when the engine split refuses it: the complement's frozen split does not flip, so nothing justifies
// leaving the acompte with no split. Left NULL, its entry was a live pro rata of the fiche: one adult more moved a booked
// entry (70600000 163,64 → 165,62). Same reason as a paid line removed (D11): a later edit rewrites no booked entry.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, WITH_ACOMPTE, NO_ACOMPTE, S, C, D, forced, free, fiche, put, pay, cancel, offered, giveAll, net, csv, rowOf, entry, register,
} = require('./journalFixture');
const { captureBucketSplit, hasAnyContrib } = require('../../../utils/forceItemContribsCapture');

const ACCOMMODATION = '70600000';
const PRESTATION = '70600010';

async function acompteAfterComplement() {
  const stay = fiche(WITH_ACOMPTE, 'direct', { customOptions: [free(142), forced(20)] });
  pay(stay.id, C);
  await put(stay, { customOptions: [free(142), forced(20), free(200, 'Ajout')] });
  pay(stay.id, D);
  return stay;
}

test('the acompte takes the stored split from its first entry, and a change of party leaves the journal byte-identical', async () => {
  const stay = await acompteAfterComplement();
  assert.notEqual(rowOf(stay.id).accommodationAcompteContribTtc, null);
  const booked = entry(stay.id, 'deposit');
  const before = csv();
  await put(stay, { adults: 3 });
  assert.equal(csv(), before);
  assert.deepEqual(entry(stay.id, 'deposit'), booked);
  assert.ok(booked[ACCOMMODATION] > 0 && booked[PRESTATION] > 0);
});

test('its complement keeps its own entry, the amounts add up to what was paid', async () => {
  const stay = await acompteAfterComplement();
  const row = rowOf(stay.id);
  assert.equal(entry(stay.id, 'complement')[PRESTATION], 18.18);
  const lines = db.prepare('SELECT acompteContribTtc AS c FROM reservation_custom_options WHERE reservationId = ?').all(stay.id);
  const sum = row.accommodationAcompteContribTtc + lines.reduce((total, line) => total + Number(line.c || 0), 0);
  assert.equal(Math.round(sum * 100) / 100, row.depositAmount);
});

test('the solde still pays, and cancelled afterwards everything given back nets every account to 0', async () => {
  const stay = await acompteAfterComplement();
  pay(stay.id, S);
  await cancel(stay.id);
  giveAll(stay.id);
  assert.deepEqual(net(stay.id), {});
  assert.equal(register(stay.id).collectedTtc, 0);
});

test('cancelled at once: acompte and complement go back, every account at 0', async () => {
  const stay = await acompteAfterComplement();
  await cancel(stay.id);
  const given = offered(stay.id);
  assert.equal(Math.round(Object.values(given).reduce((sum, amount) => sum + amount, 0) * 100) / 100, Math.round((rowOf(stay.id).depositAmount + 20) * 100) / 100);
  giveAll(stay.id);
  assert.deepEqual(net(stay.id), {});
});

test('a solde refused after a collected complement on a stay with no acompte: same reading', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { depositDisabled: 1, customOptions: [free(142), forced(20)] });
  pay(stay.id, C);
  db.prepare('UPDATE reservations SET balanceAmount = balanceAmount + 30 WHERE id = ?').run(stay.id);
  assert.equal(captureBucketSplit({ db, reservation: rowOf(stay.id), bucket: 'balance', log: { error() {} } }), 'stored');
});

test('controls — what would flip stays legacy: a complement with no readable split, an acompte or solde paid without one', async () => {
  const drifted = async () => {
    const stay = fiche(WITH_ACOMPTE, 'direct', { customOptions: [free(142), forced(20)] });
    pay(stay.id, C);
    await put(stay, { customOptions: [free(142), forced(20), free(200, 'Ajout')] });
    return stay;
  };
  const noSplit = await drifted();
  db.prepare('UPDATE reservations SET complementPaidSplit = NULL WHERE id = ?').run(noSplit.id);
  assert.equal(captureBucketSplit({ db, reservation: rowOf(noSplit.id), bucket: 'deposit', log: { error() {} } }), 'legacy');
  assert.equal(hasAnyContrib(db, noSplit.id), false);

  const adjustedSince = await drifted();
  db.prepare('UPDATE reservations SET complementAmount = complementAmount + 5 WHERE id = ?').run(adjustedSince.id);
  assert.equal(captureBucketSplit({ db, reservation: rowOf(adjustedSince.id), bucket: 'deposit', log: { error() {} } }), 'legacy');

  const soldeBooked = await drifted();
  db.prepare('UPDATE reservations SET balancePaid = 1 WHERE id = ?').run(soldeBooked.id);
  assert.equal(captureBucketSplit({ db, reservation: rowOf(soldeBooked.id), bucket: 'deposit', log: { error() {} } }), 'legacy');

  const acompteBooked = fiche(WITH_ACOMPTE, 'direct', { customOptions: [free(142), forced(20)] });
  pay(acompteBooked.id, C);
  db.prepare('UPDATE reservations SET depositPaid = 1, balanceAmount = balanceAmount + 30 WHERE id = ?').run(acompteBooked.id);
  assert.equal(captureBucketSplit({ db, reservation: rowOf(acompteBooked.id), bucket: 'balance', log: { error() {} } }), 'legacy');
});
