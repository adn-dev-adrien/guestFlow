// specs/pricing-components.md §3 rules 23, 104 (stabilisation loop t5, S5-1 and A5-1, 2026-11-16) — a paid line offered, lowered or removed through the
// fiche's « Enregistrer » is judged as through its line action: one judgment (`utils/paidLineJudgment`) inside the save. Before: the fiche save
// asked only the trop-perçu formula, which a platform stay never trips, so a card order paid in the app then offered in the fiche left its 30 €
// on no bucket (Σ buckets + notes − (price + tax) = +30), and a paid line removed from the fiche was accepted.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, beer, addDaysToIsoDate } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');
const ctrl = require('../controllers/reservationsController');
const { storedBody } = require('../utils/stayOrderLines');

const at = (id, time, offset = 0) => new Date(`${addDaysToIsoDate(row(id).startDate, offset)}T${time}:00`);
const cents = (v) => Math.round(Number(v || 0) * 100);
const notes = (id) => JSON.parse(row(id).midStaySettledNotes || '[]').reduce((sum, note) => sum + cents(note.total), 0);
const owed = (id) => Number(db.prepare("SELECT COALESCE(SUM(amountCents), 0) AS c FROM refund_obligations WHERE reservationId = ? AND origin = 'lineLowered' AND status = 'open'").get(id).c);
// Σ (acompte, solde, complements, notes) − open refund owed − (price + tax): 0 while every cent received sits in a bucket or is owed back.
const balanced = (id) => {
  const r = row(id);
  return cents(r.depositAmount) + cents(r.balanceAmount) + cents(r.complementAmount) + cents(r.endOfStayComplementAmount) + notes(id) - owed(id)
    - cents(r.finalPrice) - cents(r.touristTaxTotal);
};

// A stay three days ahead, its plan settled in full (`basket`: a 45 € basket still due in the arrival complement), and 30 € of beer ordered in
// the app and paid by card (guest-app rule 108: the card note before the arrival).
function cardPaidBeer({ platform = 'direct', basket = false } = {}) {
  const id = stay(3);
  if (platform !== 'direct') db.prepare('UPDATE reservations SET platform = ? WHERE id = ?').run(platform, id);
  const now = at(id, '12:00', -3);
  assert.equal(ctrl.performUpdate(id, { ...storedBody(id), restatePricing: true }, { now }).status, 200);
  if (basket) assert.equal(extraSale.sell(id, [{ articleRef: 'custom', label: 'Panier du terroir', amount: 45 }], { now }).status, 200);
  db.prepare("UPDATE reservations SET balancePaid = 1, balancePaidDate = '2026-01-01' WHERE id = ?").run(id); // date-literal-ok: a paid flag's date, never read by the judgment
  const requests = [{ articleRef: `option:${beer}`, quantity: 5 }];
  const quoted = extraSale.quote(id, requests, { now, source: 'shop' });
  const sold = extraSale.sell(id, requests, { now, source: 'shop', paid: { amountCents: quoted.totalCents, ref: 'card-1' }, orderRef: 'order:1' });
  assert.equal(sold.status, 200, JSON.stringify(sold.body));
  assert.equal(balanced(id), 0);
  return { id, now };
}
const offeredInFiche = (id) => {
  const body = storedBody(id);
  body.options = body.options.map((o) => (Number(o.optionId) === beer ? { ...o, offered: true } : o));
  return body;
};
const removedInFiche = (id) => {
  const body = storedBody(id);
  body.options = body.options.filter((o) => Number(o.optionId) !== beer);
  return body;
};

test('S5-1, A5-1 — a platform stay: the card-paid line offered in the fiche asks the same as its line action (409 OVERPAID), then the 30 € are owed back', () => {
  const { id, now } = cardPaidBeer({ platform: 'Booking' });
  const before = row(id);
  const saved = ctrl.performUpdate(id, offeredInFiche(id), { now });
  assert.deepEqual([saved.status, saved.body.code, saved.body.overpaymentTtc], [409, 'OVERPAID', 30]);
  assert.deepEqual([row(id).finalPrice, row(id).complementAmount], [before.finalPrice, before.complementAmount]);
  assert.equal(db.prepare('SELECT offered FROM reservation_options WHERE reservationId = ? AND optionId = ?').get(id, beer).offered, 0);
  const ref = extraSale.saleDetailOf(id, now).lines.find((line) => line.articleKey === `option:${beer}`).ref;
  assert.equal(extraSale.changeLine(id, ref, { offered: true }, { now }).body.code, 'OVERPAID');
  const forced = ctrl.performUpdate(id, { ...offeredInFiche(id), forceOverpayment: true }, { now });
  assert.equal(forced.status, 200, JSON.stringify(forced.body));
  assert.equal(owed(id), 3000);
  assert.equal(balanced(id), 0);
});

test('S5-1 — a paid line removed from the fiche body is refused 409 LINE_PAID (« offerte, pas retirée »), on a direct stay too', () => {
  for (const platform of ['Booking', 'direct']) {
    const { id, now } = cardPaidBeer({ platform });
    const saved = ctrl.performUpdate(id, removedInFiche(id), { now });
    assert.deepEqual([saved.status, saved.body.code, saved.body.error], [409, 'LINE_PAID', 'Ligne déjà payée : elle peut être offerte, pas retirée.']);
    assert.ok(db.prepare('SELECT 1 FROM reservation_options WHERE reservationId = ? AND optionId = ?').get(id, beer));
    assert.equal(balanced(id), 0);
  }
});

test('S5-1 — a direct stay with nothing left to ask: 409 OVERPAID, then the confirmed refund owed (30 €), balanced', () => {
  const { id, now } = cardPaidBeer();
  const refused = ctrl.performUpdate(id, offeredInFiche(id), { now });
  assert.deepEqual([refused.status, refused.body.code], [409, 'OVERPAID']);
  const forced = ctrl.performUpdate(id, { ...offeredInFiche(id), forceOverpayment: true }, { now });
  assert.equal(forced.status, 200, JSON.stringify(forced.body));
  assert.equal(owed(id), 3000);
  assert.equal(balanced(id), 0);
});

test('S5-1 — an open arrival complement takes the 30 € (rule 104), as through the line action', () => {
  const { id, now } = cardPaidBeer({ platform: 'Booking', basket: true });
  assert.equal(cents(row(id).complementAmount), 4500);
  const saved = ctrl.performUpdate(id, offeredInFiche(id), { now });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(cents(row(id).complementAmount), 1500);
  assert.equal(balanced(id), 0);
});
