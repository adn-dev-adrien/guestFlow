// specs/reception-role-checkin-only.md rule 18, reading of 2026-11-16 (stabilisation loop t9, A9-3 / A9-4) — while a `lineLowered`
// obligation is open, every offered paid line is locked offered for reception, read from the stored line whatever the draft; a reception
// commit that bills one again is refused 409 LINE_OWED naming the locked lines' recap keys (`owedKeys`, no amount), and the same commit with
// those keys put back goes through. Before: a draft read before the admin offered the line saw it billed with no button, and every « Valider »
// met the same refusal, which named nothing.
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

const RECEPTION = { id: 2, roles: ['reception'] };
const at = (id, time, offset = 0) => new Date(`${addDaysToIsoDate(row(id).startDate, offset)}T${time}:00`);
const owed = (id) => Number(db.prepare("SELECT COALESCE(SUM(amountCents), 0) AS c FROM refund_obligations WHERE reservationId = ? AND origin = 'lineLowered' AND status = 'open'").get(id).c);
const respond = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
const call = (fn, id, body, user) => { const res = respond(); sas[fn]({ params: { id: String(id) }, body, user, query: {} }, res); return res; };

// The beer paid by card, offered on the fiche after the reception's dialog loaded its seed (nothing offered then); 30 € owed back.
function owedAfterTheSeed() {
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

test('A9-4 — a stale reception draft: the locked line reads offered, LINE_OWED names it, put back the commit goes through', { skip: skipWithout(['sas']) }, () => {
  const id = owedAfterTheSeed();
  const door = at(id, '16:00');
  const stale = { offered: [], complementSettled: false };
  const recap = withNow(door, () => call('previewArrival', id, stale, RECEPTION)).body;
  const line = recap.lines.find((l) => l.label === 'Bière ronde');
  assert.deepEqual([line.offered, line.offerLocked, line.billed], [true, true, 0], 'shown as stored, not billed');
  const refused = withNow(door, () => call('commitArrival', id, stale, RECEPTION));
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.body.code, 'LINE_OWED');
  assert.deepEqual(refused.body.owedKeys, [line.key]);
  assert.equal(refused.body.overpaymentTtc, undefined, 'no amount to reception');
  assert.equal(owed(id), 3000, 'nothing written');
  const again = withNow(door, () => call('commitArrival', id, { ...stale, offered: [{ kind: 'option', id: beer }] }, RECEPTION));
  assert.equal(again.statusCode, 200, JSON.stringify(again.body));
  assert.equal(owed(id), 3000);
});
