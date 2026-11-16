// specs/pricing-components.md §3 rule 23 (stabilisation loop t5, A5-1, 2026-11-16) — a note paid online (an app or shop card order) is the
// establishment's money: its line given back on a live stay is owed back through the register, never by cancelling the note. Before: the
// cancel put the line back « à percevoir » and, the line then offered, the money received by card was recorded nowhere.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, beer, addDaysToIsoDate } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');
const ctrl = require('../controllers/reservationsController');
const model = require('../models/reservationsModel');
const { storedBody } = require('../utils/stayOrderLines');

const at = (id, time, offset = 0) => new Date(`${addDaysToIsoDate(row(id).startDate, offset)}T${time}:00`);

test('A5-1 — the card note of an order is not cancelled (409 NOTE_PAID_ONLINE); a cash note still is', () => {
  const id = stay(3);
  db.prepare("UPDATE reservations SET platform = 'Airbnb' WHERE id = ?").run(id);
  const now = at(id, '12:00', -3);
  assert.equal(ctrl.performUpdate(id, { ...storedBody(id), restatePricing: true }, { now }).status, 200);
  const requests = [{ articleRef: `option:${beer}`, quantity: 2 }];
  const quoted = extraSale.quote(id, requests, { now, source: 'shop' });
  assert.equal(extraSale.sell(id, requests, { now, source: 'shop', paid: { amountCents: quoted.totalCents, ref: 'card-1' }, orderRef: 'order:1' }).status, 200);
  const note = JSON.parse(row(id).midStaySettledNotes)[0];
  assert.equal(note.method, 'card');
  assert.throws(() => model.cancelMidStayNote(id, note.id), (err) => err.code === 'NOTE_PAID_ONLINE');
  const cash = JSON.parse(row(id).midStaySettledNotes).map((n) => ({ ...n, method: 'cash' }));
  db.prepare('UPDATE reservations SET midStaySettledNotes = ? WHERE id = ?').run(JSON.stringify(cash), id);
  assert.doesNotThrow(() => model.cancelMidStayNote(id, note.id));
});
