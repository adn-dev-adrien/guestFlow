// specs/sas-departure-recap-server-side.md — the departure preview endpoint and what the commit does with
// the operator's draft: one plan for both, nothing written by the preview, the displayed total compared
// (never used), the reception's view, the body never trusted for money. Real controller, real model,
// in-memory database; fictional figures.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../../database');
const registry = require('../../sdk/registry');
const controller = require('../controller');

registry.configure({ isActive: () => true, allows: () => true });

db.prepare("INSERT INTO properties (id, name, maxGuests) VALUES (1, 'Gîte fictif', 6)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Alex', 'Exemple')").run();
const TOWEL = Number(db.prepare("INSERT INTO linen_priced_items (label, price, category) VALUES ('Serviette', 6.5, 'bath')").run().lastInsertRowid);
db.prepare("INSERT INTO options (title, priceType, price, autoOptionType) VALUES ('Ménage', 'per_stay', 80, 'cleaning')").run();

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

let nextId = 900;
function stay(columns = {}) {
  const id = nextId++;
  const cols = {
    id, kind: 'reservation', clientId: 1, propertyId: 1, startDate: '2099-01-01', endDate: today(),
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
  controller[fn]({ params: { id: String(id) }, body, user, query: {} }, res);
  return res;
}
const snapshot = (id) => JSON.stringify([
  db.prepare('SELECT * FROM reservations WHERE id = ?').get(id),
  db.prepare('SELECT * FROM reservation_custom_options WHERE reservationId = ? ORDER BY id').all(id),
  db.prepare('SELECT COUNT(*) AS n FROM reservation_history WHERE reservationId = ?').get(id),
]);
const historyFields = (id) => db.prepare('SELECT changedFields FROM reservation_history WHERE reservationId = ? ORDER BY id').all(id)
  .flatMap((h) => JSON.parse(h.changedFields || '[]'));

const DRAFT = { cleaningCharged: true, missingItems: [{ itemId: TOWEL, qty: 2 }] };

test('rule 3 — the preview answers the recap and writes nothing (no row, no history, no departureSasDoneAt, no checkOutDone)', () => {
  const id = stay();
  const before = snapshot(id);
  const res = call('previewDeparture', id, { ...DRAFT, complementsSettled: true, cautionReturned: true });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.grandTotal, 93);
  assert.equal(res.body.endOfStayTotal, 93);
  assert.equal(res.body.settleable, true);
  assert.deepEqual(res.body.lines.map((l) => [l.key, l.real]), [['depCleaning', 80], [`dep:${TOWEL}`, 13]]);
  assert.equal(snapshot(id), before, 'the settlement fields are ignored too');
  const row = db.prepare('SELECT departureSasDoneAt, checkOutDone FROM reservations WHERE id = ?').get(id);
  assert.equal(row.departureSasDoneAt, null);
  assert.ok(!row.checkOutDone);
});

test('rules 2, 5, 25 — the commit stores what the preview of the same draft announced, and answers with that recap', () => {
  const id = stay({ complementAmount: 12.5 });
  db.prepare("INSERT INTO reservation_custom_options (reservationId, description, amount, inComplement) VALUES (?, 'Lit bébé', 7.7, 1)").run(id);
  const preview = call('previewDeparture', id, DRAFT).body;
  assert.equal(preview.grandTotal, 105.5);
  const commit = call('commitDeparture', id, { ...DRAFT, displayedDepartureTotal: preview.grandTotal });
  assert.equal(commit.statusCode, 200);
  assert.equal(commit.body.warning, null);
  assert.deepEqual(commit.body.recap, preview);
  const row = db.prepare('SELECT endOfStayComplementAmount, complementAmount FROM reservations WHERE id = ?').get(id);
  assert.equal(row.endOfStayComplementAmount + row.complementAmount, preview.grandTotal);
});

test('rule 5 — no amount from the body is trusted: a crafted detail, or a crafted line price, changes nothing', () => {
  const id = stay();
  const res = call('commitDeparture', id, {
    ...DRAFT,
    endOfStayComplementDetail: [{ label: 'Cadeau', qty: 1, unitPrice: 999, amount: 999 }],
    missingItems: [{ itemId: TOWEL, qty: 1, amount: 1, unitPrice: 0.01 }],
  });
  assert.equal(res.statusCode, 200);
  assert.equal(db.prepare('SELECT endOfStayComplementAmount FROM reservations WHERE id = ?').get(id).endOfStayComplementAmount, 86.5);
});

test('rules 22, 23 — a displayed total that differs: committed anyway, warned, and kept in the history', () => {
  const id = stay();
  const res = call('commitDeparture', id, { ...DRAFT, displayedDepartureTotal: 80 });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.warning, { code: 'DEPARTURE_TOTAL_DIFFERED', displayed: 80, stored: 93 });
  assert.equal(db.prepare('SELECT endOfStayComplementAmount FROM reservations WHERE id = ?').get(id).endOfStayComplementAmount, 93, 'the check-out is recorded');
  const line = historyFields(id).find((c) => c.field === 'departureRecapTotal');
  assert.ok(line, 'the difference is in the fiche history');
  assert.equal(line.label, 'Total du récapitulatif de départ');
  assert.equal(line.fromText, 'affiché 80,00 €');
  assert.equal(line.toText, 'enregistré 93,00 €');
  // Rule 23 — one more change of the departure entry, not an entry of its own.
  const entries = db.prepare("SELECT changedFields FROM reservation_history WHERE reservationId = ? AND eventType = 'sas_departure'").all(id);
  assert.equal(entries.length, 1);
  assert.ok(JSON.parse(entries[0].changedFields).length > 1, 'it sits beside the other changes of the check-out');
});

test('rule 23 — no history line when the totals match', () => {
  const id = stay();
  call('commitDeparture', id, { ...DRAFT, displayedDepartureTotal: 93 });
  assert.equal(historyFields(id).some((c) => c.field === 'departureRecapTotal'), false);
});

test('rule 14 — « Rien à percevoir » is evaluated on the planned total; a settlement is asked only above 0 €', () => {
  const id = stay();
  const empty = call('previewDeparture', id, {}).body;
  assert.equal(empty.grandTotal, 0);
  assert.equal(empty.nothingToCollect, true);
  assert.equal(empty.settleable, false);
  const billed = call('previewDeparture', id, DRAFT).body;
  assert.equal(billed.nothingToCollect, false);
  assert.equal(billed.settleable, true);
});

test('edge — an end-of-stay complement already collected: the recap says so, with the date and the till', () => {
  const id = stay({ endOfStayComplementPaid: 1, endOfStayComplementPaidDate: '2026-07-14', endOfStayComplementPaidCash: 0 });
  assert.deepEqual(call('previewDeparture', id, {}).body.endOfStayPaid, { date: '2026-07-14', cash: false });
});

test('rule 21 — the reception previews door money; a SAS locked for the reception is locked for its preview too', () => {
  const id = stay({ complementAmount: 12.5 });
  db.prepare("INSERT INTO reservation_custom_options (reservationId, description, amount, inComplement) VALUES (?, 'Lit bébé', 7.7, 1)").run(id);
  const res = call('previewDeparture', id, DRAFT, RECEPTION);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.grandTotal, 105.5);
  const locked = stay({ departureSasDoneAt: `${today()} 10:00:00` });
  const refused = call('previewDeparture', locked, {}, RECEPTION);
  assert.equal(refused.statusCode, 403);
  assert.equal(refused.body.error, 'SAS_LOCKED');
});

test('rule 3 — an unknown reservation is a 404 on the preview', () => {
  assert.equal(call('previewDeparture', 99999, {}).statusCode, 404);
});

test('rule 12 — the SAS read serves the departure seed, and only in departure mode', () => {
  const id = stay({ departureSasDoneAt: `${today()} 10:00:00`, endOfStayComplementDetail: JSON.stringify([{ label: 'Serviette', qty: 2, unitPrice: 6.5, amount: 13 }]) });
  const read = (mode) => {
    const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    controller.getSas({ params: { id: String(id) }, query: { mode }, user: ADMIN }, res);
    return res.body;
  };
  assert.deepEqual(read('departure').departureSeed.missingItems, { [TOWEL]: 2 });
  assert.equal('departureSeed' in read('arrival'), false);
});

test('specs/sas-departure-recap-server-side.md rule 27 — no departure money contract for plugin steps: a plugin payload changes nothing', () => {
  const id = stay();
  const plain = call('previewDeparture', id, DRAFT).body;
  const withStep = call('previewDeparture', id, { ...DRAFT, pluginSteps: { weather: { extra: 999 } } }).body;
  assert.deepEqual(withStep, plain);
  const commit = call('commitDeparture', id, { ...DRAFT, pluginSteps: { weather: { extra: 999 } } });
  assert.equal(commit.statusCode, 200);
  assert.equal(db.prepare('SELECT endOfStayComplementAmount FROM reservations WHERE id = ?').get(id).endOfStayComplementAmount, 93);
});
