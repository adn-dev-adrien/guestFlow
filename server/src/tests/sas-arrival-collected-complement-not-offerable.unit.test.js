// specs/sas/sas-offer-complement-lines.md rule 12 reading (stabilisation loop t9, A9-2, 2026-11-16) — a collected arrival complement's lines
// cannot be offered from the SAS: the recap serves them `offerable: false`, read as stored whatever the draft, and a raw commit offering one
// writes nothing and does not answer « offered ». Before: « Offrir » drawn, the commit answered 200 with the line offered and billed 0, and
// wrote nothing (Booking, card and « caisse interne »).
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, beer, todayIso, addDaysToIsoDate } = require('./saleRound1Fixtures');
const ctrl = require('../controllers/reservationsController');
const { storedBody } = require('../utils/stayOrderLines');
const { optionalPlugin, skipWithout } = require('../plugins/sdk/testing');
const registry = require('../plugins/sdk/registry');
const sas = optionalPlugin(() => require('../plugins/sas/controller'));

registry.configure({ isActive: () => true, allows: () => true });

const ADMIN = { id: 1, roles: ['admin'] };
const respond = () => ({ statusCode: 200, body: null, status(s) { this.statusCode = s; return this; }, json(b) { this.body = b; return this; } });
const callFiche = (handler, id, body) => { const res = respond(); handler({ params: { id: String(id) }, body, query: {}, user: ADMIN }, res); return res; };
const call = (fn, id, body, user) => { const res = respond(); sas[fn]({ params: { id: String(id) }, body, user, query: {} }, res); return res; };
const beerRow = (id) => db.prepare('SELECT offered, totalPrice FROM reservation_options WHERE reservationId = ? AND optionId = ?').get(id, beer);

for (const [platform, cash, user] of [['Booking', false, ADMIN], ['Booking', false, { id: 2, roles: ['reception'] }], ['Booking', true, ADMIN]]) {
  test(`A9-2 — ${platform}, complement collected${cash ? ' « caisse interne »' : ''} (${user.roles[0]}): no « Offrir », nothing written, nothing claimed`, { skip: skipWithout(['sas']) }, () => {
    const id = stay(0);
    db.prepare("UPDATE reservations SET platform = ?, checkInTime = '00:01', checkInDone = 0 WHERE id = ?").run(platform, id);
    const body = storedBody(id);
    body.options = [...(body.options || []), { optionId: beer, quantity: 5 }];
    assert.equal(ctrl.performUpdate(id, { ...body, restatePricing: true }, { now: new Date(`${addDaysToIsoDate(row(id).startDate, -3)}T12:00:00`) }).status, 200);
    assert.equal(callFiche(ctrl.updatePayment, id, { balancePaid: true, balancePaidDate: todayIso() }).statusCode, 200);
    const collected = callFiche(ctrl.updatePayment, id, cash ? { complementPaidCash: true, complementPaidDate: todayIso() } : { complementPaid: true, complementPaidDate: todayIso() });
    assert.equal(collected.statusCode, 200, JSON.stringify(collected.body));
    assert.equal(Number(row(id).complementPaid), 1);

    const draft = { offered: [{ kind: 'option', id: beer }], complementSettled: false };
    const recap = call('previewArrival', id, draft, user).body;
    const line = recap.lines.find((l) => l.label === 'Bière ronde');
    assert.deepEqual([line.offerable, line.offered, line.billed], [false, false, 30]);
    const before = JSON.stringify([row(id).finalPrice, row(id).complementAmount, beerRow(id)]);
    const done = call('commitArrival', id, draft, user);
    assert.equal(done.statusCode, 200, JSON.stringify(done.body));
    assert.equal(JSON.stringify([row(id).finalPrice, row(id).complementAmount, beerRow(id)]), before, 'nothing written');
    const answered = done.body.recap.lines.find((l) => l.label === 'Bière ronde');
    assert.deepEqual([answered.offered, answered.billed], [false, 30], 'the answer does not claim a gift it did not record');
  });
}
