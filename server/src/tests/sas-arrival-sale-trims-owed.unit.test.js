// specs/pricing-components.md §3 rule 120 d (stabilisation loop t9, A9-1, 2026-11-16; completes rules 23, 104, 106) — a beer paid by card (30 €)
// and offered on the fiche, its 30 € owed back; then the arrival SAS sells a 12 € basket, which the rule-104 credit pays with that money. The
// obligation shrinks to what the stay still holds beyond its total (18 €), as the fiche's save trims it, and the recap's « Déjà réglé » line
// explains the complement it asks. Before: owed 30 € AND the basket paid by the same money (12 € given twice), the recap's lines summing to
// 12 € for a complement of 0. Admin and reception alike.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, beer, addDaysToIsoDate } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');
const ctrl = require('../controllers/reservationsController');
const { withNow } = require('../utils/localDate');
const { storedBody } = require('../utils/stayOrderLines');
const { optionalPlugin, skipWithout } = require('../plugins/sdk/testing');
const registry = require('../plugins/sdk/registry');
const sas = optionalPlugin(() => require('../plugins/sas/controller'));

registry.configure({ isActive: () => true, allows: () => true });

const basket = Number(db.prepare("INSERT INTO options (title, price, priceType, category) VALUES ('Panier rond', 12, 'per_stay', 'Restauration')").run().lastInsertRowid);
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (9701, ?)').run(basket);

const at = (id, time, offset = 0) => new Date(`${addDaysToIsoDate(row(id).startDate, offset)}T${time}:00`);
const cents = (v) => Math.round(Number(v || 0) * 100);
const owed = (id) => Number(db.prepare("SELECT COALESCE(SUM(amountCents), 0) AS c FROM refund_obligations WHERE reservationId = ? AND origin = 'lineLowered' AND status = 'open'").get(id).c);
const respond = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
const call = (fn, id, body, user) => { const res = respond(); sas[fn]({ params: { id: String(id) }, body, user, query: {} }, res); return res; };
// What the stay received (solde + card note) − owed back + what it still asks − its total: constant.
const conserved = (id) => {
  const r = row(id);
  return cents(r.balanceAmount) + 3000 - owed(id) + (Number(r.complementPaid) ? 0 : cents(r.complementAmount)) - cents(r.finalPrice);
};

function owedBeer() {
  const id = stay(0);
  db.prepare("UPDATE reservations SET checkInTime = '00:01', checkInDone = 0 WHERE id = ?").run(id);
  const now = at(id, '12:00', -3);
  assert.equal(ctrl.performUpdate(id, { ...storedBody(id), restatePricing: true }, { now }).status, 200);
  db.prepare('UPDATE reservations SET balancePaid = 1, balancePaidDate = ? WHERE id = ?').run(addDaysToIsoDate(row(id).startDate, -3), id);
  const requests = [{ articleRef: `option:${beer}`, quantity: 5 }];
  const quoted = extraSale.quote(id, requests, { now, source: 'shop' });
  assert.equal(extraSale.sell(id, requests, { now, source: 'shop', paid: { amountCents: quoted.totalCents, ref: 'card-1' }, orderRef: 'order:1' }).status, 200);
  const body = storedBody(id);
  const options = body.options.map((o) => (Number(o.optionId) === beer ? { ...o, offered: true } : o));
  assert.equal(ctrl.performUpdate(id, { ...body, options, forceOverpayment: true }, { now: at(id, '13:00', -2) }).status, 200);
  assert.equal(owed(id), 3000);
  return id;
}

for (const user of [{ id: 1, roles: ['admin'] }, { id: 2, roles: ['reception'] }]) {
  test(`A9-1 — ${user.roles[0]}: the SAS sells 12 € paid by the owed money → owed 30 → 18, the recap shows « Déjà réglé » −12`, { skip: skipWithout(['sas']) }, () => {
    const id = owedBeer();
    const before = conserved(id);
    const draft = { offered: [{ kind: 'option', id: beer }], complementSettled: false, soldOptions: [{ optionId: basket, units: 1 }] };
    const door = at(id, '16:00');
    const recap = withNow(door, () => call('previewArrival', id, draft, user)).body;
    assert.equal(cents(recap.arrivalComplementTotal), 0);
    const credit = recap.lines.find((line) => line.kind === 'credit');
    assert.ok(credit && /Déjà réglé/.test(credit.label), JSON.stringify(recap.lines));
    assert.equal(cents(credit.billed), -1200);
    assert.equal(recap.lines.reduce((sum, line) => sum + cents(line.billed), 0), 0, 'the lines sum to the complement asked');
    const done = withNow(door, () => call('commitArrival', id, draft, user));
    assert.equal(done.statusCode, 200, JSON.stringify(done.body));
    assert.deepEqual([cents(row(id).finalPrice), cents(row(id).complementAmount), owed(id)], [31200, 0, 1800]);
    assert.equal(cents(ctrl.storedOverpayment(id).overpaymentTtc), 1800, 'the refund dialog proposes 18 €');
    assert.equal(conserved(id), before);
  });
}

test('A9-1 — a SAS commit that sells nothing leaves the obligation as it is', { skip: skipWithout(['sas']) }, () => {
  const id = owedBeer();
  const done = withNow(at(id, '16:00'), () => call('commitArrival', id, { offered: [{ kind: 'option', id: beer }], complementSettled: false }, { id: 1, roles: ['admin'] }));
  assert.equal(done.statusCode, 200, JSON.stringify(done.body));
  assert.equal(owed(id), 3000);
});
