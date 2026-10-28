// specs/sas-arrival-total-server-side.md — the arrival preview endpoint and what the commit does with
// the operator's choices: one plan for both, the split decided by the server, the displayed total
// compared (never used), the reception's view. Real controller, real model, in-memory database.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../../database');
const registry = require('../../sdk/registry');
const controller = require('../controller');

registry.configure({ isActive: () => true, allows: () => true });
registry.ensure('linen');

db.prepare("INSERT INTO properties (id, name, maxGuests) VALUES (1, 'Gîte fictif', 6)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Alex', 'Exemple')").run();
const PILLOW = Number(db.prepare("INSERT INTO linen_priced_items (label, price, category) VALUES ('Taie d''oreiller', 5, 'bed')").run().lastInsertRowid);
const MEAL = Number(db.prepare("INSERT INTO options (title, priceType, price) VALUES ('Le repas des trappeurs', 'per_stay', 25)").run().lastInsertRowid);

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

let nextId = 300;
function stay(columns = {}) {
  const id = nextId++;
  const cols = {
    id, kind: 'reservation', clientId: 1, propertyId: 1, startDate: today(), endDate: '2099-01-03',
    platform: 'direct', adults: 2, complementAmount: 0, ...columns,
  };
  const keys = Object.keys(cols);
  db.prepare(`INSERT INTO reservations (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map((k) => cols[k]));
  return id;
}

const ADMIN = { id: 1, roles: ['admin'] };
const RECEPTION = { id: 2, roles: ['reception'] };
function call(fn, id, body, user = ADMIN) {
  const res = {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  controller[fn]({ params: { id: String(id) }, body, user }, res);
  return res;
}
const snapshot = (id) => JSON.stringify([
  db.prepare('SELECT * FROM reservations WHERE id = ?').get(id),
  db.prepare('SELECT * FROM reservation_options WHERE reservationId = ? ORDER BY optionId').all(id),
  db.prepare('SELECT * FROM reservation_custom_options WHERE reservationId = ? ORDER BY id').all(id),
  db.prepare('SELECT COUNT(*) AS n FROM reservation_history WHERE reservationId = ?').get(id),
]);

test('rule 3 — the preview answers the recap and writes nothing (no row, no history, no arrivalSasDoneAt)', () => {
  const id = stay();
  const before = snapshot(id);
  const res = call('previewArrival', id, { linenItems: [{ itemId: PILLOW, qty: 2 }], soldOptions: [{ optionId: MEAL, units: 2 }] });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.arrivalComplementTotal, 60);
  assert.deepEqual(res.body.lines.map((l) => [l.label, l.real]), [["Taie d'oreiller", 10], ['Le repas des trappeurs', 50]]);
  assert.equal(snapshot(id), before);
});

test('rules 2, 5 — the commit stores what the preview of the same draft announced', () => {
  const id = stay();
  const body = { linenItems: [{ itemId: PILLOW, qty: 1 }], soldOptions: [{ optionId: MEAL, units: 2 }] };
  const preview = call('previewArrival', id, body).body;
  const commit = call('commitArrival', id, { ...body, displayedArrivalTotal: preview.arrivalComplementTotal });
  assert.equal(commit.statusCode, 200);
  assert.equal(commit.body.complementAmount, 55);
  assert.equal(commit.body.complementAmount, preview.arrivalComplementTotal);
  assert.equal(commit.body.warning, null);
});

test('rule 9 — stay 480 € + complement 50 € → one gesture, 530 € at arrival; offered to 0 → not unifiable', () => {
  const id = stay({ complementAmount: 50, balanceAmount: 480 });
  db.prepare("INSERT INTO reservation_custom_options (reservationId, description, amount, inComplement) VALUES (?, 'Panier', 50, 1)").run(id);
  const customId = db.prepare('SELECT id FROM reservation_custom_options WHERE reservationId = ?').get(id).id;
  const recap = call('previewArrival', id, { offeredExtras: [] }).body;
  assert.equal(recap.stayDue, 480);
  assert.equal(recap.totalAtArrival, 530);
  assert.equal(recap.unifiable, true);
  const offered = call('previewArrival', id, { offeredExtras: [{ kind: 'custom', id: customId }] }).body;
  assert.equal(offered.arrivalComplementTotal, 0);
  assert.equal(offered.unifiable, false);
});

test('rule 8 — a commit asking for one gesture on a plan that is not unifiable settles separately', () => {
  // Nothing in the complement: « CB » in one gesture would claim a complement collection that is 0 €.
  const id = stay({ balanceAmount: 480 });
  const res = call('commitArrival', id, {
    arrivalPaymentMode: 'card', arrivalPaymentSplit: false, stayPaid: true, stayPaidCash: false, complementSettled: false,
  });
  assert.equal(res.statusCode, 200);
  const row = db.prepare('SELECT balancePaid, complementPaid, arrivalPaymentGroup FROM reservations WHERE id = ?').get(id);
  assert.equal(row.balancePaid, 1, 'the stay goes through its own field');
  assert.equal(row.complementPaid, 0, 'no complement is claimed collected');
  assert.equal(row.arrivalPaymentGroup, null, 'no single payment recorded');
});

test('rules 22, 22bis — a displayed total that differs: committed anyway, warned, and kept in the history', () => {
  const id = stay();
  const res = call('commitArrival', id, {
    linenItems: [{ itemId: PILLOW, qty: 2 }], arrivalPaymentMode: 'card', arrivalPaymentSplit: true, complementSettled: true,
    displayedArrivalTotal: 5,
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.complementAmount, 10);
  assert.deepEqual(res.body.warning, { code: 'ARRIVAL_TOTAL_DIFFERED', displayed: 5, stored: 10 });
  assert.equal(db.prepare('SELECT complementPaid FROM reservations WHERE id = ?').get(id).complementPaid, 1, 'the money went through');
  const history = db.prepare('SELECT changedFields FROM reservation_history WHERE reservationId = ? ORDER BY id').all(id)
    .flatMap((h) => JSON.parse(h.changedFields || '[]'));
  const line = history.find((c) => c.field === 'arrivalRecapTotal');
  assert.ok(line, 'the difference is in the fiche history');
  assert.equal(line.fromText, 'affiché 5,00 €');
  assert.equal(line.toText, 'enregistré 10,00 €');
});

test('rule 22bis — no history line when the totals match', () => {
  const id = stay();
  call('commitArrival', id, { linenItems: [{ itemId: PILLOW, qty: 2 }], displayedArrivalTotal: 10 });
  const history = db.prepare('SELECT changedFields FROM reservation_history WHERE reservationId = ?').all(id)
    .flatMap((h) => JSON.parse(h.changedFields || '[]'));
  assert.equal(history.some((c) => c.field === 'arrivalRecapTotal'), false);
});

test('rule 23 — the reception previews door money only: no stay amount, never one gesture', () => {
  const id = stay({ complementAmount: 50, balanceAmount: 480 });
  db.prepare("INSERT INTO reservation_custom_options (reservationId, description, amount, inComplement) VALUES (?, 'Panier', 50, 1)").run(id);
  const res = call('previewArrival', id, {}, RECEPTION);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.stayDue, 0);
  assert.equal(res.body.unifiable, false);
  assert.equal(res.body.arrivalComplementTotal, 50);
});

test('rule 23 — a SAS locked for the reception is locked for its preview too', () => {
  const id = stay({ arrivalSasDoneAt: `${today()} 10:00:00` });
  const res = call('previewArrival', id, {}, RECEPTION);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'SAS_LOCKED');
});

test('rule 3 — an unknown reservation is a 404 on the preview', () => {
  assert.equal(call('previewArrival', 99999, {}).statusCode, 404);
});
