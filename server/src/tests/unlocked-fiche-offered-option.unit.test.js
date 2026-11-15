// specs/settings-rationalization.md rule 35, reading of 2026-11-13 (Adrien): on an unlocked fiche, offering a line lowers
// the final price by exactly what that line billed — the engine recalculates, the save is accepted. Any other move of the
// price stays refused (D21).
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, controller, respond, ADMIN, rowOf, NO_ACOMPTE, forced, fiche,
} = require('./moneyLedgerFixture');

async function save(stay, over) {
  const res = respond();
  await controller.update({ params: { id: stay.id }, body: { ...stay.body, ...over, unlockPast: true, forceOverpayment: true }, user: ADMIN }, res);
  return res;
}

function started(stay) {
  db.prepare("UPDATE reservations SET startDate = date('now', '-30 day'), endDate = date('now', '-28 day') WHERE id = ?").run(stay.id);
  return { startDate: rowOf(stay.id).startDate, endDate: rowOf(stay.id).endDate };
}

test('offering a billed line: saved, the final price drops by that line', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20), forced(30, 'Bain')] });
  const moved = started(stay);
  const before = rowOf(stay.id);
  const res = await save(stay, { ...moved, customOptions: [forced(20), { ...forced(30, 'Bain'), offered: true }] });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(Math.round((before.finalPrice - rowOf(stay.id).finalPrice) * 100) / 100, 30);
});

test('offering a line and adding another in the same save: still refused', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20), forced(30, 'Bain')] });
  const moved = started(stay);
  const before = rowOf(stay.id);
  const res = await save(stay, { ...moved, customOptions: [forced(20), { ...forced(30, 'Bain'), offered: true }, forced(15, 'Ajout')] });
  assert.equal(res.statusCode, 409, JSON.stringify(res.body));
  assert.equal(res.body.code, 'UNLOCKED_PRICE_CHANGED');
  assert.deepEqual(rowOf(stay.id), before);
});
