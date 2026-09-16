// Payment polling fair use (specs/payment-polling-fair-use.md rules 1, 2, 3, 4, 5, 10): expired links
// retired without a provider call, `markPaid` accepting `expired`, the age-decaying cadence persisted in
// `lastPolledAt`, the status call skipped when the expiry is known, and `force` for human requests.
// Includes the production zero-date expiry (`0001-01-01T00:00:00Z`), which must mean "no known expiry".

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const paymentLinksModel = require('../models/paymentLinksModel');
const devisModel = require('../models/devisModel');
const { runPaymentPoll, processPaidLink } = require('../utils/paymentPollRunner');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
const QONTO_ZERO_DATE = '0001-01-01T00:00:00Z';

const NOW = new Date('2026-09-15T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const isoAt = (ms) => new Date(ms).toISOString();
// createdAt is written by SQLite's datetime('now'): UTC, no zone marker.
const sqliteAgo = (ms) => isoAt(NOW.getTime() - ms).replace('T', ' ').slice(0, 19);

function seed() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Jean', 'Dupont', 'jean@x.fr')").run();
  const info = db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults,
                            finalPrice, depositAmount, balanceAmount, devisStatus)
                           VALUES ('devis', 1, 1, '2026-10-10', '2026-10-12', 2, 300, 90, 210, 'draft')`).run();
  return { db, links: paymentLinksModel.buildModel(db), devisId: Number(info.lastInsertRowid) };
}

function addLink(db, links, reservationId, { qontoId, createdAgoMs = 0, expiresAt = null, lastPolledAt = null, type = 'deposit' }) {
  const row = links.create({ reservationId, type, amountCents: 9000, qontoPaymentLinkId: qontoId, url: `https://pay/${qontoId}`, expiresAt });
  db.prepare('UPDATE payment_links SET createdAt = ?, lastPolledAt = ? WHERE id = ?').run(sqliteAgo(createdAgoMs), lastPolledAt, row.id);
  return row.id;
}

// A Qonto stub recording every call, in order, as [endpoint, remote id].
function countingQonto({ paid = false, linkStatus = 'open' } = {}) {
  const calls = [];
  return {
    calls,
    getPaymentLinkPayments: async ({ id }) => {
      calls.push(['payments', id]);
      return paid
        ? { paid: true, paidPayment: { id: 'pay_1', paid_at: '2026-09-15T11:59:00Z' }, payments: [{ status: 'paid' }] }
        : { paid: false, paidPayment: null, payments: [] };
    },
    getPaymentLink: async ({ id }) => { calls.push(['link', id]); return { id, mappedStatus: linkStatus, raw: {} }; },
  };
}

const pollDeps = (db, links, qonto, extra = {}) => ({
  database: db,
  paymentLinksModel: links,
  devisModel: devisModel.buildModel(db),
  qontoClient: qonto,
  getAccessToken: async () => 'tok_test',
  now: NOW,
  ...extra,
});

const statusOf = (db, id) => db.prepare('SELECT status FROM payment_links WHERE id = ?').get(id).status;

test('rule 1: an open link past its expiresAt is retired with zero provider calls, and its reservation is untouched', async () => {
  const { db, links, devisId } = seed();
  const id = addLink(db, links, devisId, { qontoId: 'ql_old', createdAgoMs: 30 * 24 * HOUR, expiresAt: isoAt(NOW.getTime() - HOUR) });
  const before = db.prepare('SELECT * FROM reservations WHERE id = ?').get(devisId);
  const qonto = countingQonto();

  const summary = await runPaymentPoll(pollDeps(db, links, qonto));

  assert.deepEqual(qonto.calls, [], 'no provider call at all');
  assert.equal(statusOf(db, id), 'expired');
  assert.equal(summary.retired, 1);
  assert.equal(summary.checked, 0);
  assert.equal(summary.stoppedBy, null);
  assert.deepEqual(summary.results, [{ id, reservationId: devisId, type: 'deposit', status: 'expired', effect: 'retired-locally' }]);
  assert.deepEqual(db.prepare('SELECT * FROM reservations WHERE id = ?').get(devisId), before, 'the reservation row is unchanged');
});

test('zero-date expiresAt (what Qonto returns in production) is no known expiry: never retired, status call kept', async () => {
  const { db, links, devisId } = seed();
  const id = addLink(db, links, devisId, { qontoId: 'ql_zero', expiresAt: QONTO_ZERO_DATE });
  const qonto = countingQonto({ linkStatus: 'open' });

  const summary = await runPaymentPoll(pollDeps(db, links, qonto));

  assert.equal(summary.retired, 0, 'a zero date must not retire the link');
  assert.equal(statusOf(db, id), 'open');
  assert.deepEqual(qonto.calls, [['payments', 'ql_zero'], ['link', 'ql_zero']], 'the status call still runs, so a cancellation is still detected');

  const cancelled = countingQonto({ linkStatus: 'cancelled' });
  await runPaymentPoll(pollDeps(db, links, cancelled));
  assert.equal(statusOf(db, id), 'cancelled');
});

test('knownExpiryMs: only a real date after the epoch counts as an expiry', () => {
  const { knownExpiryMs } = paymentLinksModel;
  assert.equal(knownExpiryMs(QONTO_ZERO_DATE), null);
  assert.equal(knownExpiryMs('1970-01-01T00:00:00Z'), null);
  assert.equal(knownExpiryMs(null), null);
  assert.equal(knownExpiryMs(''), null);
  assert.equal(knownExpiryMs('not a date'), null);
  assert.equal(knownExpiryMs('2026-09-20T00:00:00Z'), Date.parse('2026-09-20T00:00:00Z'));
});

test('rule 5: with a known future expiry the status call is skipped; with none it is made', async () => {
  const { db, links, devisId } = seed();
  addLink(db, links, devisId, { qontoId: 'ql_dated', expiresAt: isoAt(NOW.getTime() + 48 * HOUR) });
  addLink(db, links, devisId, { qontoId: 'ql_undated', type: 'full' });
  const qonto = countingQonto();

  const summary = await runPaymentPoll(pollDeps(db, links, qonto));

  assert.deepEqual(qonto.calls, [['payments', 'ql_dated'], ['payments', 'ql_undated'], ['link', 'ql_undated']]);
  assert.equal(summary.checked, 2);
  assert.deepEqual(summary.results.map((r) => r.status), ['open', 'open']);
});

test('rule 2: markPaid flips an expired link once and is a no-op on a paid or cancelled one', () => {
  const { links } = seed();
  const expired = links.create({ reservationId: 1, type: 'deposit', amountCents: 100, status: 'expired' });
  const first = links.markPaid(expired.id, { qontoPaymentId: 'pay_late' });
  assert.equal(first.flipped, true);
  assert.equal(first.row.status, 'paid');
  assert.equal(links.markPaid(expired.id, { qontoPaymentId: 'pay_late' }).flipped, false, 'a paid link stays final');

  const cancelled = links.create({ reservationId: 1, type: 'deposit', amountCents: 100, status: 'cancelled' });
  const res = links.markPaid(cancelled.id, { qontoPaymentId: 'pay_x' });
  assert.equal(res.flipped, false);
  assert.equal(res.row.status, 'cancelled');
});

test('rule 2 edge case: a link retired locally and then reported paid converts the devis once, with one email', async () => {
  const { db, links, devisId } = seed();
  const id = addLink(db, links, devisId, { qontoId: 'ql_late', expiresAt: isoAt(NOW.getTime() - MINUTE) });
  await runPaymentPoll(pollDeps(db, links, countingQonto()));
  assert.equal(statusOf(db, id), 'expired');

  const emails = [];
  const deps = { database: db, devisModel: devisModel.buildModel(db), paymentLinksModel: links, sendConfirmation: async (rid) => { emails.push(rid); }, paidPayment: { id: 'pay_late' } };
  const link = links.findByQontoPaymentLinkId('ql_late');
  const first = await processPaidLink({ ...deps, link });
  const second = await processPaidLink({ ...deps, link });

  assert.equal(first.effect, 'converted');
  assert.equal(second.effect, 'already-processed');
  assert.equal(statusOf(db, id), 'paid');
  assert.deepEqual(emails, [first.reservationId], 'confirmation sent exactly once');
});

test('rule 3: the three cadence tiers select and skip the right links for a fixed now', () => {
  const { db, links, devisId } = seed();
  const polled = (ms) => isoAt(NOW.getTime() - ms);
  const fresh = addLink(db, links, devisId, { qontoId: 'fresh', createdAgoMs: 2 * HOUR, lastPolledAt: polled(MINUTE) });
  const warmDue = addLink(db, links, devisId, { qontoId: 'warm-due', createdAgoMs: 48 * HOUR, lastPolledAt: polled(60 * MINUTE) });
  addLink(db, links, devisId, { qontoId: 'warm-skip', createdAgoMs: 48 * HOUR, lastPolledAt: polled(30 * MINUTE) });
  const coldDue = addLink(db, links, devisId, { qontoId: 'cold-due', createdAgoMs: 10 * 24 * HOUR, lastPolledAt: polled(24 * HOUR) });
  addLink(db, links, devisId, { qontoId: 'cold-skip', createdAgoMs: 10 * 24 * HOUR, lastPolledAt: polled(23 * HOUR) });
  const neverPolled = addLink(db, links, devisId, { qontoId: 'never', createdAgoMs: 30 * 24 * HOUR });

  const due = links.listPollable({ now: NOW }).map((l) => l.id);
  assert.deepEqual(due, [fresh, warmDue, coldDue, neverPolled]);
});

test('rule 4: every provider call stamps lastPolledAt, and a rebuilt model still honours it', async () => {
  const { db, links, devisId } = seed();
  const id = addLink(db, links, devisId, { qontoId: 'ql_warm', createdAgoMs: 3 * 24 * HOUR });
  const qonto = countingQonto();

  await runPaymentPoll(pollDeps(db, links, qonto));
  assert.equal(db.prepare('SELECT lastPolledAt FROM payment_links WHERE id = ?').get(id).lastPolledAt, NOW.toISOString());
  assert.equal(qonto.calls.length, 2);

  // A server restart = a freshly built model over the same database.
  const rebuilt = paymentLinksModel.buildModel(db);
  const quarterLater = await runPaymentPoll(pollDeps(db, rebuilt, qonto, { now: new Date(NOW.getTime() + 15 * MINUTE) }));
  assert.equal(quarterLater.checked, 0, 'not due 15 min later');
  assert.equal(qonto.calls.length, 2, 'no new provider call');

  const hourLater = await runPaymentPoll(pollDeps(db, rebuilt, qonto, { now: new Date(NOW.getTime() + HOUR) }));
  assert.equal(hourLater.checked, 1, 'due again after the hourly interval');
});

test('rule 10: force polls a link the cadence would have skipped', async () => {
  const { db, links, devisId } = seed();
  addLink(db, links, devisId, { qontoId: 'ql_recent', createdAgoMs: 3 * 24 * HOUR, lastPolledAt: isoAt(NOW.getTime() - 10 * MINUTE) });
  const qonto = countingQonto();

  const cron = await runPaymentPoll(pollDeps(db, links, qonto));
  assert.equal(cron.checked, 0);
  assert.deepEqual(qonto.calls, []);

  const manual = await runPaymentPoll(pollDeps(db, links, qonto, { force: true }));
  assert.equal(manual.checked, 1);
  assert.deepEqual(qonto.calls, [['payments', 'ql_recent'], ['link', 'ql_recent']]);
});
