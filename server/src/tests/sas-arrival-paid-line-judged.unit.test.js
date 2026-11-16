// specs/pricing-components.md §3 rules 23, 85, 104, 105, 106 and specs/sas-offer-complement-lines.md §4.3 (stabilisation loop t6, S6-3 and S6-4,
// 2026-11-16) — the arrival SAS on an article sold on two lines: a line ordered in the app and paid by card, the other sold on the fiche.
// S6-3: the re-open seed names each offered line by the recap's key, so the commit keeps exactly that line offered (before, the client seeded
// `option:<id>` and the commit offered the article's FIRST line and billed the gift again). S6-4: the commit is judged like every save of the
// stay — offering the paid line answers 409 OVERPAID and writes nothing, confirmed it is offered and its money is owed back.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, beer, todayIso, addDaysToIsoDate } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');
const ctrl = require('../controllers/reservationsController');
const reservations = require('../models/reservationsModel');
const { withNow } = require('../utils/localDate');
const { storedBody } = require('../utils/stayOrderLines');

const at = (id, time, offset = 0) => new Date(`${addDaysToIsoDate(row(id).startDate, offset)}T${time}:00`);
const cents = (v) => Math.round(Number(v || 0) * 100);
const notes = (id) => JSON.parse(row(id).midStaySettledNotes || '[]').reduce((sum, note) => sum + cents(note.total), 0);
const owed = (id) => Number(db.prepare("SELECT COALESCE(SUM(amountCents), 0) AS c FROM refund_obligations WHERE reservationId = ? AND origin = 'lineLowered' AND status = 'open'").get(id).c);
const balanced = (id) => {
  const r = row(id);
  return cents(r.depositAmount) + cents(r.balanceAmount) + cents(r.complementAmount) + cents(r.endOfStayComplementAmount) + notes(id) - owed(id)
    - cents(r.finalPrice) - cents(r.touristTaxTotal);
};
const beerLines = (id) => db.prepare('SELECT lineId, offered FROM reservation_options WHERE reservationId = ? AND optionId = ? ORDER BY lineId').all(id, beer);
// The client's conversion of a seed key into a commit ref (`arrivalDraft`'s EXISTING_REF).
const refOf = (key) => {
  const [kind, id, lineId] = String(key).split(':');
  return { kind, id: Number(id), ...(lineId ? { lineId: Number(lineId) } : {}) };
};

// A plan paid in full, beer sold on the fiche (unpaid, collected at the arrival), then beer ordered in the app and paid by card.
function twoBeerLines({ cardFirst = false } = {}) {
  const id = stay(3);
  const now = at(id, '12:00', -3);
  assert.equal(ctrl.performUpdate(id, { ...storedBody(id), restatePricing: true }, { now }).status, 200);
  db.prepare('UPDATE reservations SET balancePaid = 1, balancePaidDate = ? WHERE id = ?').run(todayIso(), id);
  const fiche = () => assert.equal(extraSale.sell(id, [{ articleRef: `option:${beer}`, quantity: 5 }], { now }).status, 200);
  const card = () => {
    const requests = [{ articleRef: `option:${beer}`, quantity: 5 }];
    const quoted = extraSale.quote(id, requests, { now, source: 'shop' });
    assert.equal(extraSale.sell(id, requests, { now, source: 'shop', paid: { amountCents: quoted.totalCents, ref: 'card-1' }, orderRef: 'order:1' }).status, 200);
  };
  if (cardFirst) { card(); fiche(); } else { fiche(); card(); }
  const [first, second] = beerLines(id).map((line) => line.lineId);
  return { id, now, first, second, paid: cardFirst ? first : second, unpaid: cardFirst ? second : first };
}

const offerLine = (id, lineId, now) => {
  const ref = `option:${lineId}`; // a catalogue line's ref is its table and lineId (extraSale.changeLine)
  let res = extraSale.changeLine(id, ref, { offered: true }, { now });
  if (res.status === 409 && res.body.code === 'OVERPAID') res = extraSale.changeLine(id, ref, { offered: true }, { now, forceOverpayment: true });
  assert.equal(res.status, 200, JSON.stringify(res.body));
};

for (const cardFirst of [false, true]) {
  test(`S6-3 — ${cardFirst ? 'the FIRST' : 'the SECOND'} of two lines offered on the fiche: the arrival seed names it, the commit keeps exactly that line offered`, () => {
    const { id, now, paid, unpaid } = twoBeerLines({ cardFirst });
    offerLine(id, unpaid, now);
    const { offeredKeys } = reservations.buildArrivalSeed(id);
    assert.equal(offeredKeys.length, 1);
    const door = at(id, '17:00');
    withNow(door, () => reservations.commitArrivalSas(id, { complementItems: [], offeredExtras: offeredKeys.map(refOf) }));
    assert.deepEqual(beerLines(id).map((line) => [line.lineId, line.offered]), [[Math.min(paid, unpaid), Math.min(paid, unpaid) === unpaid ? 1 : 0], [Math.max(paid, unpaid), Math.max(paid, unpaid) === unpaid ? 1 : 0]]);
  });
}

test('S6-4 — the arrival commit offering the card-paid line with nothing left to absorb it: 409 OVERPAID, nothing written; confirmed: offered, 30 € owed back, Σ unchanged', () => {
  const id = stay(3);
  const now = at(id, '12:00', -3);
  assert.equal(ctrl.performUpdate(id, { ...storedBody(id), restatePricing: true }, { now }).status, 200);
  db.prepare('UPDATE reservations SET balancePaid = 1, balancePaidDate = ? WHERE id = ?').run(todayIso(), id);
  const requests = [{ articleRef: `option:${beer}`, quantity: 5 }];
  const quoted = extraSale.quote(id, requests, { now, source: 'shop' });
  assert.equal(extraSale.sell(id, requests, { now, source: 'shop', paid: { amountCents: quoted.totalCents, ref: 'card-1' }, orderRef: 'order:1' }).status, 200);
  const door = at(id, '17:00');
  const before = { row: row(id), lines: beerLines(id), owed: owed(id), balanced: balanced(id) };
  const offeredExtras = [{ kind: 'option', id: beer }];
  assert.throws(() => withNow(door, () => reservations.commitArrivalSas(id, { complementItems: [], offeredExtras })), (err) => {
    assert.deepEqual([err.refusal.status, err.refusal.body.code, err.refusal.body.overpaymentTtc], [409, 'OVERPAID', 30]);
    return true;
  });
  assert.deepEqual([row(id), beerLines(id), owed(id)], [before.row, before.lines, before.owed], 'nothing written');

  withNow(door, () => reservations.commitArrivalSas(id, { complementItems: [], offeredExtras, forceOverpayment: true }));
  assert.equal(beerLines(id)[0].offered, 1);
  assert.deepEqual([owed(id), balanced(id)], [3000, before.balanced]);
});

test('S6-4 — the paid line offered while another line of the stay is still due: its money pays that line (rule 104), no refusal, Σ unchanged', () => {
  const { id, paid } = twoBeerLines();
  const start = balanced(id);
  withNow(at(id, '17:00'), () => reservations.commitArrivalSas(id, { complementItems: [], offeredExtras: [{ kind: 'option', id: beer, lineId: paid }] }));
  assert.deepEqual([beerLines(id).find((line) => line.lineId === paid).offered, owed(id), balanced(id)], [1, 0, start]);
});
