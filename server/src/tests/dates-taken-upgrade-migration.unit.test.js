// specs/payment-link-lifecycle.md rule 61 (rules 10, 31, 37 at the upgrade; plan decision (a), Adrien 2026-10-30) — the links
// already on nights a stay holds when this version first boots are withdrawn once (`dates-taken`, deactivation owed,
// no network call), and each stay gets one `dates_taken_notices` row `not-sent` / `upgrade`: the dashboard's
// « client non prévenu », never a guest e-mail (rule 43 claims that row before any send and finds it taken).

const test = require('node:test');
const assert = require('node:assert/strict');

const { db, inDays, freshProperty, addStay, addLink, linkOf } = require('./datesTakenFixture');
const { runDatesTakenUpgradeMigration, MIGRATION_NAME } = require('../utils/datesTakenUpgradeMigration');

const quietLogger = () => { const lines = []; return { lines, log: (l) => lines.push(l) }; };

test('rule 61: links on held nights are withdrawn once and their stays seeded not-sent / upgrade', () => {
  db.prepare('DELETE FROM migrations WHERE name = ?').run(MIGRATION_NAME);
  const propertyId = freshProperty();
  const holder = addStay({ propertyId, platform: 'Booking', start: inDays(40), end: inDays(44) });
  const devisId = addStay({ propertyId, kind: 'devis', start: inDays(41), end: inDays(43) });
  const a = addLink(devisId);
  const b = addLink(devisId, { type: 'full' });
  const unpaid = addStay({ propertyId, start: inDays(43), end: inDays(46) });
  const c = addLink(unpaid, { type: 'full', providerLinkId: null });
  const paidStay = addStay({ propertyId, start: inDays(40), end: inDays(42), depositPaid: 1 });
  const kept = addLink(paidStay, { type: 'balance' });
  const free = addStay({ propertyId, kind: 'devis', start: inDays(60), end: inDays(62) });
  const freeLink = addLink(free);

  const logger = quietLogger();
  const out = runDatesTakenUpgradeMigration(db, { logger });
  assert.equal(out.ran, true);
  assert.deepEqual(out.withdrawn.map((l) => l.id).sort((x, y) => x - y), [a, b, c]);
  assert.equal(out.seeded, 2, 'one row per stay, not per link');
  for (const id of [a, b]) assert.equal(linkOf(id).cancelReason, 'dates-taken');
  assert.ok(linkOf(a).remoteCancelPendingAt, 'the poll reads then deactivates it');
  assert.equal(linkOf(c).remoteCancelPendingAt, null, 'never reached the provider: nothing owed');
  assert.equal(linkOf(kept).status, 'open', 'money on the stay: not unpaid');
  assert.equal(linkOf(freeLink).status, 'open');
  const rows = db.prepare('SELECT reservationId, takenByReservationId, noticeStatus, noticeReason, emailLogId FROM dates_taken_notices WHERE reservationId IN (?, ?) ORDER BY reservationId').all(devisId, unpaid);
  assert.deepEqual(rows.map((r) => [r.noticeStatus, r.noticeReason, r.emailLogId]), [['not-sent', 'upgrade', null], ['not-sent', 'upgrade', null]]);
  assert.ok(rows.every((r) => [holder, paidStay].includes(r.takenByReservationId)));
  assert.ok(logger.lines.some((l) => l.includes(`link #${a}`) && l.includes('deactivation owed at qonto')));
  assert.match(logger.lines.at(-1), /3 link\(s\) withdrawn, 2 notice row\(s\) seeded/);
  assert.ok(logger.lines.every((l) => !/Lina|Exemple/.test(l)), 'no guest name in the boot log');
});

test('rule 61: a second boot does nothing; an existing notice row is never replaced', () => {
  const again = runDatesTakenUpgradeMigration(db, { logger: quietLogger() });
  assert.equal(again.ran, false);
  db.prepare('DELETE FROM migrations WHERE name = ?').run(MIGRATION_NAME);
  const propertyId = freshProperty();
  addStay({ propertyId, platform: 'Booking', start: inDays(70), end: inDays(73) });
  const devisId = addStay({ propertyId, kind: 'devis', start: inDays(71), end: inDays(72) });
  addLink(devisId);
  db.prepare("INSERT INTO dates_taken_notices (reservationId, noticeStatus, noticeReason) VALUES (?, 'sent', 'overlap')").run(devisId);
  const out = runDatesTakenUpgradeMigration(db, { logger: quietLogger() });
  assert.equal(out.withdrawn.length, 1);
  assert.equal(out.seeded, 0);
  assert.equal(db.prepare('SELECT noticeStatus FROM dates_taken_notices WHERE reservationId = ?').get(devisId).noticeStatus, 'sent');
});
