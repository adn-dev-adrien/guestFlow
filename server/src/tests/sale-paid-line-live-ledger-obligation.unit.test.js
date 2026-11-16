// specs/pricing-components.md §3 rule 106 a (stabilisation loop t7, UI7-1, 2026-11-16) — the open `lineLowered` obligation of a paid
// line offered on a PLATFORM stay is owed whatever the operator types elsewhere on the fiche: the live preview (`calculatePrice`, what
// a dirty fiche shows) keeps the « Trop-perçu · À rembourser » row the stored ledger shows, floored like `storedOverpayment`.
// Before: typing a note on the fiche of a Booking stay made the 30 € owed and its « Rembourser » disappear until the save.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, beer, todayIso } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');
const ctrl = require('../controllers/reservationsController');
const { storedBody } = require('../utils/stayOrderLines');

const ADMIN = { id: 1, role: 'admin' };
const respond = () => ({ statusCode: 200, body: null, status(s) { this.statusCode = s; return this; }, json(b) { this.body = b; return this; } });
const view = (id) => { const res = respond(); ctrl.getById({ params: { id: String(id) }, query: {}, user: ADMIN }, res); return res.body; };
const live = (id, edits) => new Promise((resolve) => {
  const body = storedBody(id);
  const quoteBody = { ...body, reservationId: id, selectedOptions: body.options, customOptions: body.customOptions || [], selectedResources: body.resources || [], ...edits };
  ctrl.calculatePrice({ body: quoteBody, user: ADMIN }, { status() { return this; }, json: resolve });
});

// A stay 20 days ahead, solde paid, 30 € of beer sold in the shop and paid by card, then offered with the operator's confirmation.
function offeredShopBeer(platform) {
  const id = stay(20);
  if (platform !== 'direct') db.prepare('UPDATE reservations SET platform = ? WHERE id = ?').run(platform, id);
  ctrl.performUpdate(id, { ...storedBody(id), restatePricing: true });
  db.prepare('UPDATE reservations SET balancePaid = 1, balancePaidDate = ? WHERE id = ?').run(todayIso(), id);
  const now = new Date();
  const sold = extraSale.sell(id, [{ articleRef: `option:${beer}`, quantity: 5 }], { now, source: 'shop', paid: { amountCents: 3000, source: 'shop', ref: 'T1' } });
  const ref = sold.saleDetail.lines.find((l) => l.articleKey === `option:${beer}`).ref;
  const forced = extraSale.changeLine(id, ref, { offered: true }, { now, forceOverpayment: true });
  assert.equal(forced.status, 200, JSON.stringify(forced.body));
  return id;
}

for (const platform of ['direct', 'Booking']) {
  test(`rule 106 a — ${platform}: the dirty fiche keeps the owed 30 € as its « Trop-perçu » row`, async () => {
    const id = offeredShopBeer(platform);
    const owed = db.prepare("SELECT amountCents FROM refund_obligations WHERE reservationId = ? AND origin = 'lineLowered' AND status = 'open'").all(id);
    assert.deepEqual(owed.map((o) => o.amountCents), [3000]);
    const stored = view(id).ledger.rows.find((r) => r.key === 'overpayment');
    assert.deepEqual(stored && [stored.amount, stored.stateLabel], [30, 'À rembourser']);

    const quote = await live(id, { notes: 'typed' });
    assert.equal(quote.error, undefined, JSON.stringify(quote.error));
    assert.equal(quote.overpaymentTtc, 30);
    const row = quote.ledger.rows.find((r) => r.key === 'overpayment');
    assert.ok(row, 'the live ledger still shows the money owed');
    assert.deepEqual([row.amount, row.stateLabel, row.refundPrefill.overpaymentTtc], [30, 'À rembourser', 30]);
  });
}
