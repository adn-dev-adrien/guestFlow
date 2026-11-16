// specs/mollie-rolling-reserve-and-incoming-payments.md rules 21-27 — « Versements à venir »: every sum still to arrive on the
// bank, grouped by client, with its state in words. The grouping is pure (`utils/incomingPayments`); the model gathers the
// core's kinds (instalments, platform payouts) and whatever a live plugin expects. Fictional data only.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../database');
const { buildIncoming, stateOf } = require('../utils/incomingPayments');
const { buildModel } = require('../models/incomingPaymentsModel');
const dashboard = require('../models/financeDashboardModel');
const registry = require('../plugins/sdk/registry');
const { createContext } = require('../plugins/sdk/createContext');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');
const { isAccountantAllowed } = require('../middleware/enforceRoleAccess').__test;

const TODAY = todayIso();
const at = (n) => addDaysToIsoDate(TODAY, n);

db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte du Test')").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Durand')").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (2, 'Lucia', 'Rossi')").run();
db.prepare("INSERT OR IGNORE INTO platforms (name) VALUES ('Booking')").run();

let nextId = 500;
function stay(over = {}) {
  const id = (nextId += 1);
  const row = { id, kind: 'reservation', propertyId: 1, clientId: 1, startDate: at(30), endDate: at(35), platform: 'direct', finalPrice: 900, balanceAmount: 900, ...over };
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO reservations (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => row[c]));
  return id;
}
function instalment(reservationId, number, dueDate, over = {}) {
  db.prepare('INSERT INTO reservation_installments (reservationId, number, dueDate, amountCents, paid, paidDate, paidMethod) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(reservationId, number, dueDate, over.amountCents || 30000, over.paid ? 1 : 0, over.paidDate || null, over.paidMethod || null);
}
function reset() {
  db.prepare('DELETE FROM reservation_installments').run();
  db.prepare('DELETE FROM reservations WHERE id > 500').run();
  registry.reset();
}
test.beforeEach(reset);
test.after(reset);

const stays = new Map([
  [1, { reservationId: 1, clientId: 1, clientName: 'Camille Durand', label: 'Gîte · 12/12 → 15/12/2026', startDate: at(30), endDate: at(33) }],
  [2, { reservationId: 2, clientId: 1, clientName: 'Camille Durand', label: 'Gîte · 02/03 → 05/03/2027', startDate: at(120), endDate: at(123) }],
  [3, { reservationId: 3, clientId: 2, clientName: 'Lucia Rossi', label: 'Gîte · 20/12 → 22/12/2026', startDate: at(40), endDate: at(42) }],
]);
const item = (over) => ({
  key: `k${Math.random()}`, kind: 'installment', kindLabel: 'Échéance', icon: 'calendar', natureLabel: 'Échéance 1 sur 3', natureDetail: '',
  reservationId: 1, amountCents: 10000, expectedDate: at(3), receivedDate: null, ...over,
});

test('rule 22 — every state is a sentence computed here: « Dans 3 jours », « Dans 2 mois », « En retard de 12 j », « Reçu le … »', () => {
  assert.deepEqual(stateOf({ expectedDate: at(3) }, TODAY), { state: 'upcoming', stateLabel: 'Dans 3 jours', tone: 'neutral' });
  assert.equal(stateOf({ expectedDate: at(0) }, TODAY).stateLabel, 'Aujourd\'hui');
  assert.equal(stateOf({ expectedDate: at(1) }, TODAY).stateLabel, 'Demain');
  assert.equal(stateOf({ expectedDate: at(61) }, TODAY).stateLabel, 'Dans 2 mois');
  assert.deepEqual(stateOf({ expectedDate: at(-12) }, TODAY), { state: 'late', stateLabel: 'En retard de 12 j', tone: 'error' });
  const received = stateOf({ expectedDate: at(-40), receivedDate: '2026-10-30' }, TODAY); // date-literal-ok: only formatted, never compared with today
  assert.deepEqual(received, { state: 'received', stateLabel: 'Reçu le 30/10', tone: 'success' });
  assert.equal(stateOf({ expectedDate: at(-2), late: false }, TODAY).stateLabel, 'Attendu depuis 2 j', 'a provider that says « not late yet » is believed');
});

test('rule 22 — one block per client, late clients first, then the next date; a client with several stays has one block', () => {
  const out = buildIncoming({
    today: TODAY, stays,
    items: [
      item({ key: 'a', reservationId: 1, expectedDate: at(10), amountCents: 10000 }),
      item({ key: 'b', reservationId: 2, expectedDate: at(60), amountCents: 20000 }),
      item({ key: 'c', reservationId: 3, expectedDate: at(2), amountCents: 5000 }),
    ],
  });
  assert.deepEqual(out.clients.map((c) => c.name), ['Lucia Rossi', 'Camille Durand']);
  const camille = out.clients[1];
  assert.equal(camille.totalCents, 30000);
  assert.equal(camille.nextDate, at(10));
  assert.deepEqual(camille.stays.map((s) => s.reservationId), [1, 2], 'one line group per stay, soonest first');
  assert.deepEqual(out.totals, { amount: 350, amountCents: 35000, clients: 2, nextDate: at(2), nextDateLabel: out.totals.nextDateLabel });
  const late = buildIncoming({ today: TODAY, stays, items: [item({ key: 'a', reservationId: 1, expectedDate: at(10) }), item({ key: 'c', reservationId: 3, expectedDate: at(-4) })] });
  assert.deepEqual(late.clients.map((c) => [c.name, c.late]), [['Lucia Rossi', true], ['Camille Durand', false]]);
});

test('rule 23 — an item past its window is red and sorts first inside its stay; the kinds come with their counts', () => {
  const out = buildIncoming({
    today: TODAY, stays,
    items: [
      item({ key: 'soon', expectedDate: at(2) }),
      item({ key: 'old', expectedDate: at(-9), kind: 'platformPayout', kindLabel: 'Versement plateforme', icon: 'house' }),
      item({ key: 'reserve', expectedDate: at(80), kind: 'mollieReserve', kindLabel: 'Retenue Mollie', icon: 'hourglass' }),
      item({ key: 'transit', expectedDate: at(1), kind: 'mollieTransit', kindLabel: 'Mollie en transit', icon: 'card' }),
    ],
  });
  const lines = out.clients[0].stays[0].items;
  assert.deepEqual(lines.map((l) => l.key), ['old', 'transit', 'soon', 'reserve']);
  assert.equal(lines[0].state, 'late');
  assert.deepEqual(out.kinds, [
    { key: 'mollieReserve', label: 'Retenue Mollie', count: 1 }, { key: 'mollieTransit', label: 'Mollie en transit', count: 1 },
    { key: 'installment', label: 'Échéance', count: 1 }, { key: 'platformPayout', label: 'Versement plateforme', count: 1 },
  ]);
});

test('rule 24 — « Reçus récemment » lists what arrived, with its bank date and the identifiers of its credit, newest first', () => {
  const refs = { qonto: 'solio-6791-1-transaction-019d1b2f-0001', mollieSettlement: 'T19274230.2611.01', molliePayment: 'tr_abc' };
  const out = buildIncoming({
    today: TODAY, stays, recent: true,
    items: [
      item({ key: 'old', receivedDate: at(-20), refs, expectedDate: at(-24) }),
      item({ key: 'new', receivedDate: at(-2), expectedDate: at(-5), reservationId: 3 }),
      item({ key: 'pending', expectedDate: at(3) }),
    ],
  });
  assert.deepEqual(out.clients.flatMap((c) => c.stays.flatMap((s) => s.items.map((i) => i.key))), ['new', 'old']);
  assert.equal(out.clients[1].stays[0].items[0].refs.qonto, refs.qonto);
  assert.equal(out.clients[0].stays[0].items[0].refs.qonto, null, 'no credit identifiers means null, never missing');
  assert.equal(out.totals.nextDate, null);
  assert.equal(out.totals.amountCents, 20000);
});

test('rule 21 — the total, the number of clients and the next date; an empty list is an empty payload', () => {
  assert.deepEqual(buildIncoming({ today: TODAY, stays, items: [] }), { totals: { amount: 0, amountCents: 0, clients: 0, nextDate: null, nextDateLabel: null }, kinds: [], clients: [] });
  const out = buildIncoming({ today: TODAY, stays, items: [item({ amountCents: 184230, expectedDate: at(2), reservationId: 3 })] });
  assert.equal(out.totals.amount, 1842.3);
});

test('rule 23 — the core\'s kinds: an unpaid instalment on its due date, a platform payout once the guest has left', () => {
  const planned = stay({ clientId: 2, installmentsTarget: 900 });
  instalment(planned, 1, at(5));
  instalment(planned, 2, at(-6));
  instalment(planned, 3, at(40), { paid: true, paidDate: at(-1), paidMethod: 'transfer' });
  const booking = stay({ platform: 'Booking', startDate: at(-20), endDate: at(-15), balanceAmount: 600, finalPrice: 600, platformCommissionAmount: 100 });
  const out = buildModel(db).get({ today: TODAY });
  const lines = out.clients.flatMap((c) => c.stays.map((s) => ({ client: c.name, stay: s.reservationId, items: s.items })));
  const mine = lines.find((l) => l.stay === planned).items;
  assert.deepEqual(mine.map((i) => [i.natureLabel, i.state]), [['Échéance 2 sur 3', 'late'], ['Échéance 1 sur 3', 'upcoming']]);
  assert.equal(mine[0].stateLabel, 'En retard de 6 j');
  assert.equal(mine[1].stateLabel, 'Dans 5 jours');
  const payout = lines.find((l) => l.stay === booking).items[0];
  assert.equal(payout.kind, 'platformPayout');
  assert.equal(payout.natureLabel, 'Versement plateforme · Booking');
  assert.equal(payout.amountCents, 50000, 'the solde net of the platform\'s commission');
  assert.deepEqual(out.kinds.map((k) => k.key), ['installment', 'platformPayout']);
});

test('rule 23 — a stay a plan already covers, a cancelled stay and a payout not yet due are not expected', () => {
  const covered = stay({ installmentsTarget: 900, installmentsPaidAmount: 900 });
  instalment(covered, 1, at(5));
  const cancelled = stay({ cancelledAt: TODAY, installmentsTarget: 900 });
  instalment(cancelled, 1, at(5));
  stay({ platform: 'Booking', startDate: at(10), endDate: at(14), balanceAmount: 600, finalPrice: 600 });
  assert.deepEqual(buildModel(db).get({ today: TODAY }).clients, []);
});

test('rule 24 — recently received instalments by transfer or cheque, a platform payout marked received; cash never reached the bank', () => {
  const planned = stay({ installmentsTarget: 900 });
  instalment(planned, 1, at(-10), { paid: true, paidDate: at(-4), paidMethod: 'transfer' });
  instalment(planned, 2, at(-10), { paid: true, paidDate: at(-4), paidMethod: 'cash' });
  instalment(planned, 3, at(-50), { paid: true, paidDate: at(-45), paidMethod: 'transfer' });
  const out = buildModel(db).get({ today: TODAY, recent: true });
  const items = out.clients.flatMap((c) => c.stays.flatMap((s) => s.items));
  assert.deepEqual(items.map((i) => i.natureLabel), ['Échéance 1 sur 3']);
  assert.equal(items[0].stateLabel, `Reçu le ${at(-4).slice(8, 10)}/${at(-4).slice(5, 7)}`);
});

test('rule 25 — without the plugin the Mollie kinds are absent, not zero; with it they join the same table', () => {
  const planned = stay({});
  instalment(planned, 1, at(5));
  assert.deepEqual(buildModel(db).get({ today: TODAY }).kinds.map((k) => k.key), ['installment']);

  registry.configure({ isActive: () => true, allows: () => true });
  createContext('online-payment', { db }).incomingPayments(({ recent }) => (recent ? [] : [{
    key: 'mollie:1', kind: 'mollieReserve', kindLabel: 'Retenue Mollie', icon: 'hourglass', natureLabel: 'Retenue Mollie', natureDetail: '20 % retenus',
    reservationId: planned, amountCents: 14648, expectedDate: at(80), receivedDate: null, late: false,
  }]));
  const out = buildModel(db).get({ today: TODAY });
  assert.deepEqual(out.kinds.map((k) => k.key), ['mollieReserve', 'installment']);
  assert.equal(out.totals.amountCents, 30000 + 14648);
  registry.configure({ isActive: () => false, allows: () => true });
  assert.deepEqual(buildModel(db).get({ today: TODAY }).kinds.map((k) => k.key), ['installment'], 'a plugin that is not live adds nothing');
});

test('rule 25 — a provider that throws is skipped and logged; the core\'s kinds stay', () => {
  const planned = stay({});
  instalment(planned, 1, at(5));
  registry.configure({ isActive: () => true, allows: () => true });
  createContext('online-payment', { db }).incomingPayments(() => { throw new Error('boom'); });
  const quiet = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(buildModel(db).get({ today: TODAY }).kinds.map((k) => k.key), ['installment']);
  } finally {
    console.error = quiet;
  }
});

test('rule 21 — the dashboard tile ignores the period: the same figures whatever the window', () => {
  const planned = stay({});
  instalment(planned, 1, at(5));
  const tile = (params) => dashboard.getDashboard(params).data.tiles.incoming;
  const year = tile({ period: 'fy' });
  assert.deepEqual(year, { amount: 300, clients: 1, nextDate: at(5) });
  assert.deepEqual(tile({ period: 'month', month: at(-200).slice(0, 7) }), year);
});

test('rules 21, 26 — the detail table is the same payload as GET /api/finance/incoming, the recent switch included', () => {
  const planned = stay({});
  instalment(planned, 1, at(5));
  instalment(planned, 2, at(-10), { paid: true, paidDate: at(-3), paidMethod: 'transfer' });
  const detail = dashboard.getDashboardDetail('incoming', {});
  assert.equal(detail.ok, true);
  assert.deepEqual(detail.data, buildModel(db).get({ today: TODAY }));
  const recent = dashboard.getDashboardDetail('incoming', { recent: '1' });
  assert.deepEqual(recent.data.clients[0].stays[0].items.map((i) => i.state), ['received']);
  const finance = require('../controllers/financeController');
  const res = { body: null, status() { return this; }, json(b) { this.body = b; return this; } };
  finance.getIncoming({ query: { recent: '1' } }, res);
  assert.deepEqual(res.body, recent.data);
});

test('rule 27 — the table overlaps « En attente de règlement » on purpose: an unpaid instalment is in both', () => {
  const planned = stay({ installmentsTarget: 900 });
  instalment(planned, 1, at(-3));
  const detail = dashboard.getDashboardDetail('incoming', {}).data;
  assert.equal(detail.clients[0].stays[0].items[0].kind, 'installment');
  const late = dashboard.getDashboardDetail('late', {}).data;
  assert.ok(late.rows.some((r) => Number(r.id) === planned), 'the guests-owe view still lists it');
});

test('§4.3 — the accountant reads the table; no other role or write is opened', () => {
  assert.equal(isAccountantAllowed('GET', '/finance/incoming'), true);
  assert.equal(isAccountantAllowed('GET', '/finance/dashboard'), false);
  assert.equal(isAccountantAllowed('POST', '/finance/incoming'), false);
});
