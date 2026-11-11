// specs/payment-link-lifecycle.md rule 12 — a stay set aside as a duplicate (`superseded`) withdraws its open links
// (`cancelReason = 'superseded'`, deactivation owed): in the lifecycle pass (rule 16, its own row or the stay its devis
// became) and in `supersededDuplicates` when it sets the row aside. Rule 31: that one-shot reads « carries money » from
// the shared stayMoney predicate, cash twins included.

const test = require('node:test');
const assert = require('node:assert/strict');

const { db, inDays, freshProperty, addStay, addLink, linkOf } = require('./datesTakenFixture');
const { retireLapsedAndWithdrawn } = require('../utils/paymentLinkLifecycle');
const { setAsideDuplicates, findCandidates } = require('../utils/supersededDuplicates');

const withdrawnSuperseded = (id) => {
  const link = linkOf(id);
  return link.status === 'cancelled' && link.cancelReason === 'superseded' && Boolean(link.remoteCancelPendingAt);
};

test('rule 12: the lifecycle pass withdraws the open link of a stay set aside', () => {
  const propertyId = freshProperty();
  const stay = addStay({ propertyId, kind: 'superseded', start: inDays(40), end: inDays(42) });
  const link = addLink(stay, { type: 'full' });
  const moved = retireLapsedAndWithdrawn(db, { now: new Date() });
  assert.ok(moved.some((l) => l.id === link));
  assert.ok(withdrawnSuperseded(link));
});

test('rule 12: the link of a devis whose stay was set aside goes with it; a link without provider id owes nothing', () => {
  const propertyId = freshProperty();
  const stay = addStay({ propertyId, kind: 'superseded', start: inDays(50), end: inDays(52) });
  const devisId = addStay({ propertyId, kind: 'devis', start: inDays(50), end: inDays(52), convertedReservationId: stay });
  const link = addLink(devisId, { providerLinkId: null });
  retireLapsedAndWithdrawn(db, { now: new Date() });
  const row = linkOf(link);
  assert.equal(row.status, 'cancelled');
  assert.equal(row.cancelReason, 'superseded');
  assert.equal(row.remoteCancelPendingAt, null);
});

function hiddenCopy(propertyId, start, end, extra = {}) {
  db.prepare("INSERT OR IGNORE INTO ical_sources (propertyId, name, url, platformKey, platformLabel, isActive, disabled) VALUES (?, 'Lodgify', '', 'lodgify', 'Lodgify', 0, 1)").run(propertyId);
  return addStay({ propertyId, platform: 'Lodgify', start, end, extra });
}

test('rule 12: setting a duplicate aside withdraws its open links, the deactivation owed', () => {
  const propertyId = freshProperty();
  addStay({ propertyId, start: inDays(60), end: inDays(64) });
  const copy = hiddenCopy(propertyId, inDays(61), inDays(63));
  const link = addLink(copy, { type: 'balance' });
  const found = setAsideDuplicates(db);
  assert.ok(found.superseded.some((s) => s.id === copy));
  assert.ok(withdrawnSuperseded(link));
});

test('rule 31: a copy paid in cash carries money and is flagged, never set aside', () => {
  const propertyId = freshProperty();
  addStay({ propertyId, start: inDays(70), end: inDays(74) });
  const copy = hiddenCopy(propertyId, inDays(71), inDays(73), { depositPaidCash: 1 });
  const found = findCandidates(db);
  assert.ok(found.conflicts.some((c) => c.id === copy && c.why === 'paid'));
});
