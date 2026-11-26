// specs/guest-app/guest-app.md rule 113 a and specs/pricing/pricing-components.md rule 23 (stabilisation loop t6, A6-2, 2026-11-16) — a note paid online (an app
// or shop card order) is never adjusted either: « Modifier la note » refuses a new amount or « Caisse interne » (409 NOTE_PAID_ONLINE), only
// its date moves, and the fiche serves the lock so « Modifier » is not drawn. Before: lowering the 12 € card note to 6 € put 6 € back in the
// departure remainder (the guest asked again for money paid online), and « Caisse interne » took 12 € received by card off the books.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, beer, addDaysToIsoDate } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');
const ctrl = require('../controllers/reservationsController');
const { storedBody } = require('../utils/stayOrderLines');

const ADMIN = { id: 1, role: 'admin' };
const at = (id, time, offset = 0) => new Date(`${addDaysToIsoDate(row(id).startDate, offset)}T${time}:00`);
const respond = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const patch = (id, body) => { const res = respond(); ctrl.updatePayment({ params: { id: String(id) }, body, query: {}, user: ADMIN }, res); return res; };
const view = (id) => { const res = respond(); ctrl.getById({ params: { id: String(id) }, query: {}, user: ADMIN }, res); return res.body; };
const noteOf = (id) => JSON.parse(row(id).midStaySettledNotes)[0];

// A Booking stay, an app order of 2 beers (12 €) paid by card before the arrival.
function cardOrder() {
  const id = stay(3);
  db.prepare("UPDATE reservations SET platform = 'Booking' WHERE id = ?").run(id);
  const now = at(id, '12:00', -3);
  assert.equal(ctrl.performUpdate(id, { ...storedBody(id), restatePricing: true }, { now }).status, 200);
  const requests = [{ articleRef: `option:${beer}`, quantity: 2 }];
  const quoted = extraSale.quote(id, requests, { now, source: 'shop' });
  assert.equal(extraSale.sell(id, requests, { now, source: 'shop', paid: { amountCents: quoted.totalCents, ref: 'card-1' }, orderRef: 'order:1' }).status, 200);
  const note = noteOf(id);
  assert.deepEqual([note.method, note.total, Number(note.paidCash || 0)], ['card', 12, 0]);
  return { id, note };
}

test('A6-2 — the card note keeps its amount: 12 → 6 is refused, nothing moves back to the departure', () => {
  const { id, note } = cardOrder();
  const before = row(id);
  const res = patch(id, { adjustMidStayNote: { id: note.id, total: 6 } });
  assert.deepEqual([res.statusCode, res.body.code], [409, 'NOTE_PAID_ONLINE']);
  assert.equal(res.body.error, 'Payée en ligne : offrir la ligne, puis rembourser.');
  assert.equal(noteOf(id).total, 12);
  assert.equal(row(id).endOfStayComplementAmount, before.endOfStayComplementAmount);
  assert.equal(row(id).endOfStayComplementDetail, before.endOfStayComplementDetail);
});

test('A6-2 — the card note keeps its means: « Caisse interne » is refused, the card money stays on the books', () => {
  const { id, note } = cardOrder();
  const res = patch(id, { adjustMidStayNote: { id: note.id, cash: true } });
  assert.deepEqual([res.statusCode, res.body.code], [409, 'NOTE_PAID_ONLINE']);
  assert.equal(Number(noteOf(id).paidCash || 0), 0);
});

test('A6-2 — its date still moves, and a form sent back unchanged (same amount, same means) is accepted', () => {
  const { id, note } = cardOrder();
  const day = addDaysToIsoDate(row(id).startDate, -4);
  const res = patch(id, { adjustMidStayNote: { id: note.id, total: 12, cash: false, paidDate: day } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual([noteOf(id).total, Number(noteOf(id).paidCash || 0), noteOf(id).paidDate], [12, 0, day]);
});

test('A6-2 — the fiche serves the lock on the card note only; a cash note is adjusted as before', () => {
  const { id, note } = cardOrder();
  assert.deepEqual(view(id).midStayNoteLocks, { [note.id]: 'Payée en ligne : offrir la ligne, puis rembourser.' });
  const cash = JSON.parse(row(id).midStaySettledNotes).map((n) => ({ ...n, method: 'cash' }));
  db.prepare('UPDATE reservations SET midStaySettledNotes = ? WHERE id = ?').run(JSON.stringify(cash), id);
  assert.deepEqual(view(id).midStayNoteLocks, {});
  const res = patch(id, { adjustMidStayNote: { id: note.id, cash: true } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(Number(noteOf(id).paidCash), 1);
});
