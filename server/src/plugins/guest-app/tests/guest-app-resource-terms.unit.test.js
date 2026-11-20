// specs/gift-voucher-campaigns.md rules 37-38 — the terms of the `resource` activity in the guest app: a cart holding the bath owes them once
// per published version and per stay; nothing is asked while nothing is published; the acceptance lands on the stay with the channel
// « guest-app » and in its history; an outdated version is refused.
const fx = require('./guestOrderFixtures');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addBath, db, isoPlus, openOrdering, seedStay, sell,
} = fx;
const registry = require('../../sdk/registry');
const { skipWithout } = require('../../sdk/testing');
const termsModel = require('../../../models/termsModel');

const BATH = addBath({ id: 81 });
sell('resource', BATH);
db.prepare('UPDATE resources SET heatUpMinutes = 0, heatRetentionMinutes = 0, turnoverMinutes = 0, showsPlanningCard = 1 WHERE id = ?').run(BATH);

const publish = (label) => termsModel.publishVersion({
  activity: 'resource', markdownFr: `# ${label}`, markdownEn: `# ${label}`, htmlFr: `<h2>${label}</h2>`, htmlEn: `<h2>${label} EN</h2>`, variables: {}, contentHash: `hash-${label}`, publishedAt: new Date().toISOString(),
});

// One bath session, `n` hours after 10:00, on the third day of the stay: two orders of a test never share a slot.
const bathLines = (n = 0) => [{
  kind: 'resource', id: BATH, sessions: [{ date: isoPlus(3), start: `${10 + n}:00`, end: `${11 + n}:00` }],
}];

function withBath(name, fn) {
  test(name, { skip: skipWithout(['hourly-resources']) }, async () => {
    db.prepare('DELETE FROM terms_acceptances').run();
    db.prepare("DELETE FROM terms_versions WHERE activity = 'resource'").run();
    db.prepare('DELETE FROM resource_bookings').run();
    db.prepare('DELETE FROM reservation_resources').run();
    const stayId = seedStay({ start: 1, end: 9, checkedIn: 0 });
    const ctx = await openOrdering(stayId, { guestHost: 'sejour.example.test' });
    registry.ensure('hourly-resources').termsActivities.push({ key: 'resource', label: 'Bain nordique et activités', seed: null });
    try {
      await fn({ stayId, ...ctx });
    } finally {
      await ctx.close();
    }
  });
}

const acceptancesOf = (stayId) => db.prepare("SELECT * FROM terms_acceptances WHERE reservationId = ? AND activity = 'resource'").all(stayId);
const historyOf = (stayId) => db.prepare("SELECT changedFields FROM reservation_history WHERE reservationId = ? AND eventType = 'terms_accepted'").all(stayId)
  .flatMap((r) => JSON.parse(r.changedFields));

withBath('rule 37: nothing published → nothing asked, the order passes', async ({ stayId, call }) => {
  const quote = await call('POST', '/public/v1/guest/orders/quote', { lines: bathLines() });
  assert.equal(quote.status, 200, JSON.stringify(quote.body));
  assert.equal(quote.body.data.termsRequired, undefined);
  const order = await call('POST', '/public/v1/guest/orders', { lines: bathLines(), payment: 'note' });
  assert.equal(order.status, 200, JSON.stringify(order.body));
  assert.equal(acceptancesOf(stayId).length, 0);
});

withBath('rule 37: a published version → the quote names it; the order without it is TERMS_NOT_ACCEPTED, nothing written', async ({ stayId, call }) => {
  const v1 = publish('v1');
  const quote = await call('POST', '/public/v1/guest/orders/quote', { lines: bathLines() });
  assert.deepEqual(quote.body.data.termsRequired, [{
    activity: 'resource', label: 'Bain nordique et activités', version: 1, versionId: v1.id, url: '/terms/resource',
  }]);
  const refused = await call('POST', '/public/v1/guest/orders', { lines: bathLines(), payment: 'note' });
  assert.equal(refused.status, 422);
  assert.equal(refused.body.error.code, 'TERMS_NOT_ACCEPTED');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM guest_orders WHERE reservationId = ?').get(stayId).n, 0);
  assert.equal(acceptancesOf(stayId).length, 0);
});

withBath('rule 38: accepted → the order passes, the acceptance is on the stay (channel guest-app) and in its history; once per version', async ({ stayId, call }) => {
  const v1 = publish('v1');
  const placed = await call('POST', '/public/v1/guest/orders', { lines: bathLines(), payment: 'note', acceptedTerms: [{ activity: 'resource', versionId: v1.id }] });
  assert.equal(placed.status, 200, JSON.stringify(placed.body));
  const [row] = acceptancesOf(stayId);
  assert.deepEqual([row.activity, row.subjectType, row.subjectRef, row.channel, row.termsVersionId], ['resource', 'reservation', String(stayId), 'guest-app', v1.id]);
  assert.deepEqual(historyOf(stayId).map((h) => [h.label, h.to]), [['Conditions générales — Bain nordique et activités', 'Version 1 acceptée']]);
  // Same stay, same version: not asked again, and the quote says when it was accepted.
  const quote = await call('POST', '/public/v1/guest/orders/quote', { lines: bathLines(1) });
  assert.equal(quote.body.data.termsRequired, undefined);
  assert.equal(quote.body.data.termsAccepted[0].activity, 'resource');
  assert.match(quote.body.data.termsAccepted[0].acceptedAtLabel, /^\d{2}\/\d{2}\/\d{4}$/);
  const second = await call('POST', '/public/v1/guest/orders', { lines: bathLines(1), payment: 'note' });
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal(acceptancesOf(stayId).length, 1, 'no second record for the same version');
});

withBath('rule 37: a new version is asked again; a stale version sent is TERMS_OUTDATED', async ({ stayId, call }) => {
  const v1 = publish('v1');
  assert.equal((await call('POST', '/public/v1/guest/orders', { lines: bathLines(), payment: 'note', acceptedTerms: [{ activity: 'resource', versionId: v1.id }] })).status, 200);
  const v2 = publish('v2');
  const quote = await call('POST', '/public/v1/guest/orders/quote', { lines: bathLines(1) });
  assert.equal(quote.body.data.termsRequired[0].versionId, v2.id);
  const stale = await call('POST', '/public/v1/guest/orders', { lines: bathLines(1), payment: 'note', acceptedTerms: [{ activity: 'resource', versionId: v1.id }] });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, 'TERMS_OUTDATED');
  const fresh = await call('POST', '/public/v1/guest/orders', { lines: bathLines(1), payment: 'note', acceptedTerms: [{ activity: 'resource', versionId: v2.id }] });
  assert.equal(fresh.status, 200, JSON.stringify(fresh.body));
  assert.deepEqual(acceptancesOf(stayId).map((a) => a.termsVersionId), [v1.id, v2.id]);
});

withBath('rule 37: the text of the current version is served in the guest\'s language; an unknown or unpublished activity is 404', async ({ call }) => {
  const v1 = publish('v1');
  const text = await call('GET', '/public/v1/guest/terms/resource');
  assert.equal(text.status, 200);
  assert.deepEqual([text.body.data.version, text.body.data.html], [1, '<h2>v1</h2>']);
  assert.equal((await call('GET', '/public/v1/guest/terms/resource?lang=en')).body.data.html, '<h2>v1 EN</h2>');
  assert.equal((await call('GET', '/public/v1/guest/terms/lodging')).status, 404, 'nothing published for the lodging in this test');
  assert.equal((await call('GET', '/public/v1/guest/terms/nothing')).status, 404);
  assert.ok(v1.id);
});

withBath('input: acceptedTerms must be a list of { activity, versionId }', async ({ call }) => {
  const res = await call('POST', '/public/v1/guest/orders', { lines: bathLines(), payment: 'note', acceptedTerms: 'yes' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'INVALID_INPUT');
});
