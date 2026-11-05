// « Taxe de séjour en complément » cannot go on over a tax already collected (audit R23-N2):
//   specs/force-item-to-complement.md rule 20 — else the guest is asked twice and a booked entry is rewritten.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, controller, respond, rowOf, ADMIN, TODAY, NO_ACOMPTE, WITH_ACOMPTE, PLATFORM, S, C, fiche, put, pay, ficheView,
} = require('./moneyLedgerFixture');
const installmentsController = require('../controllers/installmentsController');

const CODE = 'TOURIST_TAX_ALREADY_COLLECTED';
async function save(stay, over = {}) {
  const res = respond();
  await controller.update({ params: { id: stay.id }, body: { ...stay.body, forceOverpayment: true, ...over }, user: ADMIN }, res);
  return res;
}
const assertLocked = async (stay) => {
  const before = JSON.stringify(rowOf(stay.id));
  const res = await save(stay, { touristTaxInComplement: 1 });
  assert.equal(res.statusCode, 409, JSON.stringify(res.body));
  assert.equal(res.body.code, CODE);
  assert.equal(JSON.stringify(rowOf(stay.id)), before, 'nothing written');
};
async function planOf(id) {
  const res = respond();
  await installmentsController.put({ params: { id }, body: { count: 2 }, user: ADMIN }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return db.prepare('SELECT id FROM reservation_installments WHERE reservationId = ? ORDER BY number').all(id);
}
function payInstallment(id, installment) {
  const res = respond();
  installmentsController.markPaid({ params: { id, installmentId: installment.id }, body: { paidDate: TODAY, method: 'transfer' }, user: ADMIN }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
}

test('rule 20: solde paid holding the tax: refused, the forced way through too, the fiche says why', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct');
  assert.equal(ficheView(stay.id).touristTaxInComplementLockedReason, null);
  pay(stay.id, S);
  assert.ok(rowOf(stay.id).touristTaxSoldeContribTtc > 0);
  await assertLocked(stay);
  assert.equal(ficheView(stay.id).touristTaxInComplementLockedReason, 'collected-on-solde');
});

test('rule 20: the solde unticked first, the switch goes on', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct');
  pay(stay.id, S);
  pay(stay.id, { balancePaid: false });
  assert.equal((await save(stay, { touristTaxInComplement: 1 })).statusCode, 200);
  assert.equal(rowOf(stay.id).touristTaxInComplement, 1);
});

test('rule 20: a solde with no contribs (legacy) held the tax', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct');
  pay(stay.id, S);
  db.prepare('UPDATE reservations SET touristTaxSoldeContribTtc = NULL WHERE id = ?').run(stay.id);
  await assertLocked(stay);
});

test('rule 20: a paid solde that holds no tax does not lock', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct');
  pay(stay.id, S);
  db.prepare('UPDATE reservations SET touristTaxSoldeContribTtc = 0 WHERE id = ?').run(stay.id);
  assert.equal((await save(stay, { touristTaxInComplement: 1 })).statusCode, 200);
});

test('rule 20: a paid acompte holding part of the tax locks; one holding none does not', async () => {
  const stay = fiche(WITH_ACOMPTE, 'direct');
  pay(stay.id, { depositPaid: true, depositPaidDate: TODAY });
  db.prepare('UPDATE reservations SET touristTaxAcompteContribTtc = 1.2 WHERE id = ?').run(stay.id);
  await assertLocked(stay);
  assert.equal(ficheView(stay.id).touristTaxInComplementLockedReason, 'collected-on-acompte');
  db.prepare('UPDATE reservations SET touristTaxAcompteContribTtc = 0 WHERE id = ?').run(stay.id);
  assert.equal((await save(stay, { touristTaxInComplement: 1 })).statusCode, 200);
});

test('rule 20: a paid installment holding a tax share locks; a plan with nothing paid does not', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct');
  const plan = await planOf(stay.id);
  assert.equal(ficheView(stay.id).touristTaxInComplementLockedReason, null);
  payInstallment(stay.id, plan[0]);
  await assertLocked(stay);
  assert.equal(ficheView(stay.id).touristTaxInComplementLockedReason, 'collected-on-installment');
});

test('rule 20: a value sent back unchanged passes, on or off; switching off stays possible', async () => {
  const on = fiche(NO_ACOMPTE, 'direct', { touristTaxInComplement: 1 });
  pay(on.id, S, C);
  assert.equal(ficheView(on.id).touristTaxInComplementLockedReason, null);
  assert.equal((await save(on, { notes: 'unchanged flag' })).statusCode, 200);
  assert.equal((await save(on, { touristTaxInComplement: 0 })).statusCode, 200);
  assert.equal(rowOf(on.id).touristTaxInComplement, 0);

  const off = fiche(NO_ACOMPTE, 'direct');
  pay(off.id, S);
  assert.equal((await save(off, { touristTaxInComplement: 0, notes: 'unchanged flag' })).statusCode, 200);
});

test('rule 20: the preview carries the reason, so the switch greys as the fiche moves', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct');
  pay(stay.id, S);
  const res = respond();
  await controller.calculatePrice({ body: { ...stay.body, reservationId: stay.id }, user: ADMIN }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.touristTaxInComplementLockedReason, 'collected-on-solde');
});

test('rule 20: a refusal and an ordinary save leave what the solde holds of the tax', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct');
  pay(stay.id, S);
  const solde = rowOf(stay.id).touristTaxSoldeContribTtc;
  await assertLocked(stay);
  assert.equal(rowOf(stay.id).touristTaxSoldeContribTtc, solde);
  await put(stay, { notes: 'an ordinary save' });
  assert.equal(rowOf(stay.id).touristTaxSoldeContribTtc, solde);
});

test('rule 20, reading: a move to a platform taking the tax on arrival is the same switch, refused the same way', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct');
  pay(stay.id, S);
  const before = JSON.stringify(rowOf(stay.id));
  const res = await save(stay, { platform: PLATFORM.owner });
  assert.equal(res.statusCode, 409, JSON.stringify(res.body));
  assert.equal(res.body.code, CODE);
  assert.equal(JSON.stringify(rowOf(stay.id)), before, 'nothing written');
});

test('rule 20, reading: a platform reversing the tax passes, the same platform passes, an unpaid stay moves freely', async () => {
  const reversed = fiche(NO_ACOMPTE, 'direct');
  pay(reversed.id, S);
  assert.equal((await save(reversed, { platform: PLATFORM.reversed })).statusCode, 200);
  assert.equal(rowOf(reversed.id).platform, PLATFORM.reversed);

  const same = fiche(NO_ACOMPTE, PLATFORM.owner);
  pay(same.id, S, C);
  assert.equal((await save(same, { platform: PLATFORM.owner })).statusCode, 200, 'no move');

  const unpaid = fiche(NO_ACOMPTE, 'direct');
  assert.equal((await save(unpaid, { platform: PLATFORM.owner })).statusCode, 200);
  assert.equal(rowOf(unpaid.id).platform, PLATFORM.owner);
});
