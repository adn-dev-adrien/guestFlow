// specs/reception-role-checkin-only.md rule 18 (loop t7 A7-1) — at the SAS a reception-only account never sees the amount a paid line would owe
// back and cannot force it: the 409 names no amount, `forceOverpayment` is dropped, nothing is written. The admin flow is unchanged.
// Loop t8 A8-1 / A8-2 / A8-3 — the refusal keeps the recap keys of the refused lines (no money); the departure commit is held the same way;
// and the reverse gesture: an offered paid line whose money is owed back is locked offered for reception, and un-offering it is refused.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, stay, row, beer, todayIso, addDaysToIsoDate,
} = require('./saleRound1Fixtures');
const reservations = require('../models/reservationsModel');
const { withNow } = require('../utils/localDate');
const extraSale = require('../utils/extraSale');
const ctrl = require('../controllers/reservationsController');
const { storedBody } = require('../utils/stayOrderLines');
const { toReceptionSasCommit } = require('../utils/receptionView');
const { optionalPlugin, skipWithout } = require('../plugins/sdk/testing');

const sasController = optionalPlugin(() => require('../plugins/sas/controller'));
const SAS = { skip: skipWithout(['sas']) };
const at = (id, time, offset = 0) => new Date(`${addDaysToIsoDate(row(id).startDate, offset)}T${time}:00`);
const owed = (id) => Number(db.prepare("SELECT COALESCE(SUM(amountCents), 0) AS c FROM refund_obligations WHERE reservationId = ? AND origin = 'lineLowered' AND status = 'open'").get(id).c);
const offeredOf = (id) => db.prepare('SELECT offered FROM reservation_options WHERE reservationId = ? AND optionId = ?').all(id, beer).map((r) => Number(r.offered));
const respond = () => ({
  statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; },
});
const RECEPTION = { id: 2, roles: ['reception'] };
const ADMIN = { id: 1, roles: ['admin'] };

function paidBeerStay() {
  const id = stay(0);
  db.prepare('UPDATE reservations SET checkInTime = ?, checkInDone = 0 WHERE id = ?').run('00:01', id);
  const now = at(id, '12:00', -3);
  assert.equal(ctrl.performUpdate(id, { ...storedBody(id), restatePricing: true }, { now }).status, 200);
  db.prepare('UPDATE reservations SET balancePaid = 1, balancePaidDate = ? WHERE id = ?').run(addDaysToIsoDate(row(id).startDate, -3), id);
  const requests = [{ articleRef: `option:${beer}`, quantity: 5 }];
  const quoted = extraSale.quote(id, requests, { now, source: 'shop' });
  assert.equal(extraSale.sell(id, requests, {
    now, source: 'shop', paid: { amountCents: quoted.totalCents, ref: 'card-1' }, orderRef: 'order:1',
  }).status, 200);
  return id;
}

const commit = (id, user, extra = {}) => {
  const res = respond();
  sasController.commitArrival({ params: { id: String(id) }, body: { offered: [{ kind: 'option', id: beer }], complementSettled: false, ...extra }, user }, res);
  return res;
};

test('toReceptionSasCommit drops forceOverpayment and keeps the rest', () => {
  assert.deepEqual(toReceptionSasCommit({ forceOverpayment: true, cautionReceived: true }), { cautionReceived: true });
});

test('reception: the 409 on a paid line names no amount, forcing it is still refused, nothing is written', SAS, () => {
  const id = paidBeerStay();
  const first = commit(id, RECEPTION);
  assert.equal(first.statusCode, 409);
  assert.equal(first.body.code, 'OVERPAID');
  assert.equal('overpaymentTtc' in first.body, false);
  assert.deepEqual(Object.keys(first.body).sort(), ['code', 'error', 'overpaymentKeys']);
  assert.doesNotMatch(first.body.error, /\d/);
  assert.deepEqual(first.body.overpaymentKeys, [`option:${beer}`], 'the refused line by its recap key (A8-2), no amount');
  const forced = commit(id, RECEPTION, { forceOverpayment: true });
  assert.equal(forced.statusCode, 409);
  assert.equal('overpaymentTtc' in forced.body, false);
  assert.equal(owed(id), 0);
  assert.deepEqual(offeredOf(id).filter((v) => v === 1), []);
});

test('admin: the same commit answers the amount, and forcing it opens the refund obligation', SAS, () => {
  const id = paidBeerStay();
  const first = commit(id, ADMIN);
  assert.equal(first.statusCode, 409);
  assert.equal(first.body.overpaymentTtc, 30);
  const forced = commit(id, ADMIN, { forceOverpayment: true });
  assert.equal(forced.statusCode, 200);
  assert.equal(owed(id), 3000);
});

const call = (fn, id, body, user, query = {}) => {
  const res = respond();
  sasController[fn]({ params: { id: String(id) }, body, user, query }, res);
  return res;
};
const lineOf = (body, key) => {
  const found = [];
  JSON.stringify(body, (k, v) => { if (v && typeof v === 'object' && v.key === key && 'offered' in v) found.push(v); return v; });
  return found[0] || null;
};
const RECEPTION_ANSWER = 'Ligne déjà payée : à voir avec l’administrateur.';

// A plan paid in full; beer ordered in the app and paid by card, then a second beer sold unpaid on the fiche. The arrival SAS leaves the
// complement unpaid, so today's check-out recalls it.
function recalledStay({ offeredAtArrival = null } = {}) {
  const id = stay(-3);
  db.prepare('UPDATE reservations SET checkInDone = 0 WHERE id = ?').run(id);
  const now = at(id, '12:00', -3);
  assert.equal(ctrl.performUpdate(id, { ...storedBody(id), restatePricing: true }, { now }).status, 200);
  db.prepare('UPDATE reservations SET balancePaid = 1, balancePaidDate = ? WHERE id = ?').run(todayIso(), id);
  const requests = [{ articleRef: `option:${beer}`, quantity: 5 }];
  const quoted = extraSale.quote(id, requests, { now, source: 'shop' });
  assert.equal(extraSale.sell(id, requests, { now, source: 'shop', paid: { amountCents: quoted.totalCents, ref: 'card-1' }, orderRef: 'order:1' }).status, 200);
  assert.equal(extraSale.sell(id, requests, { now }).status, 200);
  const lines = db.prepare('SELECT lineId FROM reservation_options WHERE reservationId = ? AND optionId = ? ORDER BY lineId').all(id, beer);
  const refs = [{ kind: 'option', id: beer }, { kind: 'option', id: beer, lineId: lines[1].lineId }];
  // `offeredAtArrival` — the admin adjusted the complement to 30 € (rule 104 credits no adjusted complement), then the admin's arrival SAS
  // offers the paid beer and confirms the trop-perçu: its 30 € is owed back while the complement, still unpaid, is recalled at the check-out.
  if (offeredAtArrival) db.prepare('UPDATE reservations SET complementAmountOverride = 30 WHERE id = ?').run(id);
  withNow(at(id, '17:00'), () => reservations.commitArrivalSas(id, {
    complementItems: [], ...(offeredAtArrival ? { offeredExtras: [refs[0]], forceOverpayment: true } : {}),
  }));
  return { id, refs };
}

// The admin offers the card-paid beer on the fiche and confirms: 30 € owed back to the guest.
function adminOffersOnFiche(id, now) {
  const body = storedBody(id);
  const options = (body.options || []).map((o) => (Number(o.optionId) === Number(beer) ? { ...o, offered: true } : o));
  assert.equal(ctrl.performUpdate(id, { ...body, options, forceOverpayment: true }, { now }).status, 200);
  assert.equal(owed(id), 3000);
}

test('A8-3 — reception at the departure: offering the paid recalled line → 409 with no amount, forcing it refused, nothing written', SAS, () => {
  const { id, refs } = recalledStay();
  const before = { row: row(id), offered: offeredOf(id) };
  const first = call('commitDeparture', id, { offeredArrivalExtras: refs }, RECEPTION);
  assert.equal(first.statusCode, 409);
  assert.deepEqual([first.body.code, first.body.error, 'overpaymentTtc' in first.body], ['OVERPAID', RECEPTION_ANSWER, false]);
  assert.deepEqual(first.body.overpaymentKeys, [`option:${beer}`]);
  const forced = call('commitDeparture', id, { offeredArrivalExtras: refs, forceOverpayment: true }, RECEPTION);
  assert.equal(forced.statusCode, 409);
  assert.deepEqual([row(id), offeredOf(id), owed(id)], [before.row, before.offered, 0], 'nothing written');
  const unpaidOnly = call('commitDeparture', id, { offeredArrivalExtras: [refs[1]] }, RECEPTION);
  assert.equal(unpaidOnly.statusCode, 200, 'the unpaid line is still offered freely');
});

test('A8-1 — arrival: the admin offered a paid line (30 € owed); reception sees it locked offered and cannot un-offer it; the admin can', SAS, () => {
  const id = paidBeerStay();
  adminOffersOnFiche(id, at(id, '12:00', -3));
  const key = `option:${beer}`;
  const preview = call('previewArrival', id, { offered: [{ kind: 'option', id: beer }], complementSettled: false }, RECEPTION);
  assert.equal(preview.statusCode, 200);
  assert.deepEqual([lineOf(preview.body, key).offered, lineOf(preview.body, key).offerLocked], [true, true]);
  const adminPreview = call('previewArrival', id, { offered: [{ kind: 'option', id: beer }], complementSettled: false }, ADMIN);
  assert.equal(Boolean(lineOf(adminPreview.body, key).offerLocked), false, 'the admin keeps the toggle');

  const before = { row: row(id), offered: offeredOf(id) };
  const un = call('commitArrival', id, { offered: [], complementSettled: false }, RECEPTION);
  assert.equal(un.statusCode, 409);
  assert.deepEqual([un.body.error, un.body.code], [RECEPTION_ANSWER, 'LINE_OWED']);
  assert.doesNotMatch(JSON.stringify(un.body), /\d/);
  assert.deepEqual([row(id), offeredOf(id), owed(id)], [before.row, before.offered, 3000], 'nothing written, still owed');

  const kept = call('commitArrival', id, { offered: [{ kind: 'option', id: beer }], complementSettled: false }, RECEPTION);
  assert.equal(kept.statusCode, 200, 'the seed kept goes through');
  assert.equal(owed(id), 3000);

  const admin = call('commitArrival', id, { offered: [], complementSettled: false }, ADMIN);
  assert.equal(admin.statusCode, 200);
  assert.equal(owed(id), 0, 'the admin bills it again: the obligation closes (rule 109)');
});

test('A8-1 — departure: the admin offered the paid beer at the arrival (30 € owed, adjusted complement recalled); reception sees it locked and cannot bill it again', SAS, () => {
  const { id, refs } = recalledStay({ offeredAtArrival: true });
  assert.equal(owed(id), 3000);
  const preview = call('previewDeparture', id, { offeredArrivalExtras: [refs[0]] }, RECEPTION);
  assert.equal(preview.statusCode, 200);
  const lines = [];
  JSON.stringify(preview.body, (k, v) => { if (v && typeof v === 'object' && 'offerable' in v && String(v.key || '').startsWith('option:')) lines.push(v); return v; });
  assert.deepEqual(lines.map((l) => [l.offered, Boolean(l.offerLocked)]), [[true, true], [false, false]], 'the paid line locked, the unpaid one free');
  const adminPreview = call('previewDeparture', id, { offeredArrivalExtras: [refs[0]] }, ADMIN);
  assert.equal(Boolean(lineOf(adminPreview.body, `option:${beer}`).offerLocked), false, 'the admin keeps the toggle');
  const before = { row: row(id), offered: offeredOf(id) };
  for (const offered of [[], [refs[1]]]) {
    const un = call('commitDeparture', id, { offeredArrivalExtras: offered }, RECEPTION);
    assert.equal(un.statusCode, 409);
    assert.deepEqual([un.body.error, un.body.code], [RECEPTION_ANSWER, 'LINE_OWED']);
    assert.deepEqual([row(id), offeredOf(id), owed(id)], [before.row, before.offered, 3000], 'nothing written, still owed');
  }
  const kept = call('commitDeparture', id, { offeredArrivalExtras: [refs[0]] }, RECEPTION);
  assert.equal(kept.statusCode, 200, 'keeping it offered goes through');
  assert.equal(owed(id), 3000);
});
