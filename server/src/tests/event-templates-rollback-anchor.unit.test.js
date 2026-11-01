// specs/self-update-and-releases.md rule 43, reading of 2026-11-01 (audit R11 console N1) — the generic guard: every
// default template sent on an event or an action (`EVENT_TRIGGERED_STABLE_KEYS`) or outside the policy
// (`AUTO_SEND_EXCEPTIONS`) is out of the rollback floor's date-driven queue. Either the floor excludes it by name,
// or it is seeded manual on an anchor the floor's queue never matches — never on `start`. A new event template
// that forgets its anchor fails here, before any release.
const test = require('node:test');
const assert = require('node:assert/strict');

const { DEFAULT_TEMPLATES, EVENT_TRIGGERED_STABLE_KEYS } = require('../utils/defaultEmailTemplatesRegistry');
const { AUTO_SEND_EXCEPTIONS } = require('../utils/autoSendPolicy');
const { localIsoDate } = require('../utils/localDate');
const { freshDb, seedProperty } = require('./guestEmailSequenceFixtures');
const { FLOOR_EVENT_KEYS, FLOOR_QUEUE_ANCHORS, floorQueue } = require('./rollbackFloorQueue');

const outOfQueueKeys = [...new Set([...EVENT_TRIGGERED_STABLE_KEYS, ...AUTO_SEND_EXCEPTIONS])];
const unknownToFloor = outOfQueueKeys.filter((key) => !FLOOR_EVENT_KEYS.includes(key));

test('rule 43 (R11 N1) - every event or exception template is a default template', () => {
  for (const key of outOfQueueKeys) assert.ok(DEFAULT_TEMPLATES.some((t) => t.stableKey === key), key);
  assert.ok(unknownToFloor.includes('installment_request'));
  assert.ok(unknownToFloor.includes('dates_unavailable_notice'));
});

for (const key of unknownToFloor) {
  test(`rule 43 (R11 N1) - ${key}: unknown to the floor, so manual on an anchor its queue never reads`, () => {
    const def = DEFAULT_TEMPLATES.find((t) => t.stableKey === key);
    assert.equal(def.sendMode, 'manual');
    assert.ok(def.anchor && def.anchor !== 'start', `${key} carries no anchor, the seed would write 'start'`);
    assert.ok(!FLOOR_QUEUE_ANCHORS.includes(def.anchor), `${key} on '${def.anchor}', an anchor the floor's queue matches`);
  });
}

test('rule 43 (R11 N1) - over a seeded install, the floor offers none of them for a stay arriving today', () => {
  const db = freshDb();
  const propertyId = seedProperty(db);
  const today = localIsoDate(new Date());
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'A', 'B')").run();
  db.prepare("INSERT INTO reservations (clientId, propertyId, startDate, endDate, kind) VALUES (1, ?, ?, date(?, '+3 days'), 'reservation')").run(propertyId, today, today);
  db.prepare(`UPDATE email_templates SET enabled = 1 WHERE stableKey IN (${outOfQueueKeys.map(() => '?').join(', ')})`).run(...outOfQueueKeys);
  const offered = floorQueue(db, today);
  for (const key of outOfQueueKeys) assert.ok(!offered.includes(key), key);
});
