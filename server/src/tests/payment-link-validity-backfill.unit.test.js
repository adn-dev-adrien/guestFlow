// specs/payment-link-lifecycle.md rule 34 — the links already open at the upgrade get 36 hours of grace
// from the install: `expiresAt = max(createdAt + 36 h, installedAt + 36 h)`, Qonto's zero-time sentinel and
// complement links included; paid, cancelled and expired rows untouched; once, logged per link.

process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { seedDb, addStay, addLink } = require('./paymentLinkLifecycleFixture');
const { runPaymentLinkValidityBackfill, MIGRATION_NAME } = require('../utils/paymentLinkValidityBackfill');
const { retireLapsedAndWithdrawn } = require('../utils/paymentLinkLifecycle');

const INSTALL = new Date('2026-11-04T09:00:00Z');
const GRACE = '2026-11-05T21:00:00.000Z';

function setup() {
  const { db, links } = seedDb();
  db.exec("CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, ran_at TEXT DEFAULT (datetime('now')))");
  const stay = addStay(db);
  const lines = [];
  const logger = { log: (line) => lines.push(line) };
  return { db, links, stay, lines, logger };
}

test('rule 34 — every open link gets install + 36 h, the sentinel and a complement included; a log line each', () => {
  const { db, links, stay, lines, logger } = setup();
  const old = addLink(links, db, stay, { createdAt: new Date('2026-05-02T10:00:00Z') });
  const sentinel = links.create({ reservationId: stay, type: 'full', amountCents: 30000, providerLinkId: 'pl_zero', url: 'u', expiresAt: '0001-01-01T00:00:00Z' });
  const complement = addLink(links, db, stay, { type: 'complement', createdAt: new Date('2026-10-30T10:00:00Z') });

  const { ran, backfilled } = runPaymentLinkValidityBackfill(db, { now: INSTALL, logger });

  assert.equal(ran, true);
  assert.deepEqual(backfilled.map((l) => l.id), [old.id, sentinel.id, complement.id]);
  [old, sentinel, complement].forEach((l) => assert.equal(links.findById(l.id).expiresAt, GRACE));
  assert.deepEqual(lines, [
    `[migration:link-validity] link #${old.id} (deposit) expires ${GRACE}`,
    `[migration:link-validity] link #${sentinel.id} (full) expires ${GRACE}`,
    `[migration:link-validity] link #${complement.id} (complement) expires ${GRACE}`,
  ]);
});

test('rule 34 — the later of the two ends wins (a link created after the install clock keeps its own 36 h)', () => {
  const { db, links, stay, logger } = setup();
  const late = addLink(links, db, stay, { createdAt: new Date('2026-11-04T10:00:00Z') });
  runPaymentLinkValidityBackfill(db, { now: INSTALL, logger });
  assert.equal(links.findById(late.id).expiresAt, '2026-11-05T22:00:00.000Z');
});

test('rule 34 — paid, cancelled and expired rows are never touched', () => {
  const { db, links, stay, logger } = setup();
  const rows = ['paid', 'cancelled', 'expired'].map((status) => addLink(links, db, stay, { status }));
  runPaymentLinkValidityBackfill(db, { now: INSTALL, logger });
  rows.forEach((l) => assert.equal(links.findById(l.id).expiresAt, null));
});

test('rule 34 — runs once: a second boot changes nothing and logs nothing', () => {
  const { db, links, stay, lines, logger } = setup();
  const link = addLink(links, db, stay);
  runPaymentLinkValidityBackfill(db, { now: INSTALL, logger });
  lines.length = 0;
  db.prepare('UPDATE payment_links SET expiresAt = NULL WHERE id = ?').run(link.id);

  const second = runPaymentLinkValidityBackfill(db, { now: new Date('2026-11-10T09:00:00Z'), logger });

  assert.equal(second.ran, false);
  assert.equal(links.findById(link.id).expiresAt, null);
  assert.deepEqual(lines, []);
  assert.ok(db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(MIGRATION_NAME));
});

test('rule 34 — the grace then ends like any validity: open until install + 36 h, lapsed after', () => {
  const { db, links, stay, logger } = setup();
  const link = addLink(links, db, stay, { createdAt: new Date('2026-05-02T10:00:00Z') });
  runPaymentLinkValidityBackfill(db, { now: INSTALL, logger });
  retireLapsedAndWithdrawn(db, { now: new Date('2026-11-05T20:59:59Z'), paymentLinksModel: links });
  assert.equal(links.findById(link.id).status, 'open');
  retireLapsedAndWithdrawn(db, { now: new Date(GRACE), paymentLinksModel: links });
  assert.equal(links.findById(link.id).cancelReason, 'validity');
});

test('rule 34 — database.js runs the backfill at boot, after the orphans are withdrawn', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'database.js'), 'utf8');
  const orphans = src.indexOf('runOrphanPaymentLinksMigration(db)');
  const backfill = src.indexOf('runPaymentLinkValidityBackfill(db)');
  assert.ok(orphans > 0 && backfill > orphans);
});
