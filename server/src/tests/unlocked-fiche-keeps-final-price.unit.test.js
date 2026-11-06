// specs/settings-rationalization.md rule 35 (D21, Adrien, 2026-11-06) — « Lorsqu'on déverrouille une fiche il faut autoriser
// que les modifications possibles qui ne changent pas le prix final. » The admin unlock of a started stay exists to correct
// the amounts expected from the platforms: a save that moves the final price or the tourist tax is refused 409
// UNLOCKED_PRICE_CHANGED and writes nothing; every save that keeps both passes. The ledger's solde editor, which reaches
// a solde by moving the accommodation price, refuses on an unlocked fiche too (reservation-payment-ledger rule 18 reading).
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, controller, respond, ADMIN, rowOf, NO_ACOMPTE, PLATFORM, C, forced, fiche, pay,
} = require('./moneyLedgerFixture');
const { liveQuote } = require('./ledgerFixture');
const { formatEuros } = require('../utils/reservationLedger');

async function save(stay, over, user = ADMIN) {
  const res = respond();
  await controller.update({ params: { id: stay.id }, body: { ...stay.body, ...over, forceOverpayment: true }, user }, res);
  return res;
}

// Each started stay on two nights of its own, back from today, so the suite's stays never overlap.
let slot = 0;
function started(stay) {
  slot += 1;
  db.prepare("UPDATE reservations SET startDate = date('now', ?), endDate = date('now', ?) WHERE id = ?")
    .run(`-${4 * slot} day`, `-${4 * slot - 2} day`, stay.id);
  return { startDate: rowOf(stay.id).startDate, endDate: rowOf(stay.id).endDate };
}

const unlocked = (moved) => ({ ...moved, unlockPast: true });

test('the platform expected amounts move, the final price stays: saved', async () => {
  const stay = fiche(NO_ACOMPTE, PLATFORM.reversed, { customOptions: [forced(20)], platformGrossAmount: 640 });
  pay(stay.id, C);
  const moved = started(stay);
  const before = rowOf(stay.id);
  const res = await save(stay, unlocked({ ...moved, platformGrossAmount: 640, platformPayoutAmount: 560.5, platformCommissionAmount: 79.5 }));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const after = rowOf(stay.id);
  assert.equal(after.platformPayoutAmount, 560.5);
  assert.equal(after.platformCommissionAmount, 79.5);
  assert.equal(after.finalPrice, before.finalPrice);
  assert.equal(after.touristTaxTotal, before.touristTaxTotal);
});

test('a text, a client and the same nights one day earlier: saved, the price unchanged', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  const moved = started(stay);
  const before = rowOf(stay.id);
  const res = await save(stay, unlocked({
    ...moved, notes: 'Arrivée tardive',
    startDate: db.prepare("SELECT date(?, '-1 day') AS d").get(moved.startDate).d,
    endDate: db.prepare("SELECT date(?, '-1 day') AS d").get(moved.endDate).d,
  }));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(rowOf(stay.id).notes, 'Arrivée tardive');
  assert.equal(rowOf(stay.id).finalPrice, before.finalPrice);
});

for (const [label, over] of [
  ['one adult more', { adults: 3 }],
  ['a 30 € line', { customOptions: [forced(20), forced(30, 'Ajout')] }],
  ['a discount (a lowering)', { discountPercent: 10 }],
  ['one night more', { endDate: null }],
]) {
  test(`${label}: refused 409, nothing written`, async () => {
    const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
    const moved = started(stay);
    const body = { ...over };
    if ('endDate' in body) body.endDate = db.prepare("SELECT date(?, '+1 day') AS d").get(moved.endDate).d;
    const before = rowOf(stay.id);
    const res = await save(stay, unlocked({ ...moved, ...body }));
    assert.equal(res.statusCode, 409, JSON.stringify(res.body));
    assert.equal(res.body.code, 'UNLOCKED_PRICE_CHANGED');
    assert.equal(res.body.error, `Fiche déverrouillée : le prix final doit rester à ${formatEuros(before.finalPrice)}.`);
    assert.deepEqual(rowOf(stay.id), before);
  });
}

test('the tourist tax alone moves: refused with its own wording', async () => {
  // The tax counts the adults, the price the guests: one child becomes an adult.
  const stay = fiche(NO_ACOMPTE, 'direct', { adults: 2, children: 1, customOptions: [forced(20)] });
  const moved = started(stay);
  const before = rowOf(stay.id);
  const res = await save(stay, unlocked({ ...moved, adults: 3, children: 0 }));
  assert.equal(res.statusCode, 409, JSON.stringify(res.body));
  assert.equal(res.body.code, 'UNLOCKED_PRICE_CHANGED');
  assert.match(res.body.error, /^Fiche déverrouillée : la taxe de séjour doit rester à /);
  assert.equal(rowOf(stay.id).touristTaxTotal, before.touristTaxTotal);
});

test('the same discount on the locked fiche (not unlocked) is not judged by D21', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  const moved = started(stay);
  const res = await save(stay, { ...moved, discountPercent: 10 });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
});

test('a stay not started with the unlock flag is not judged', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  const res = await save(stay, { adults: 3, unlockPast: true });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
});

test('the solde editor on an unlocked fiche: a different solde is refused, the same one passes', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', {});
  const moved = started(stay);
  const row = rowOf(stay.id);
  const quote = (amount) => liveQuote(stay.id, { ...moved, propertyId: NO_ACOMPTE, ledgerEdit: { row: 'balance', amount }, unlockPast: true });
  const refused = (await quote(row.balanceAmount - 50)).ledgerEdit;
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'Fiche déverrouillée : le prix final ne change pas.');
  assert.equal((await quote(row.balanceAmount)).ledgerEdit.ok, true);
  const locked = (await liveQuote(stay.id, { ...moved, propertyId: NO_ACOMPTE, ledgerEdit: { row: 'balance', amount: row.balanceAmount - 50 } })).ledgerEdit;
  assert.equal(locked.reason, 'Séjour commencé : passer par « Prix hébergement ajusté ».');
});
