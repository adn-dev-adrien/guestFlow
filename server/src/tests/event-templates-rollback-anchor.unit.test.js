// specs/self-update-and-releases.md rule 43, readings of 2026-11-01 (audit R11 console N1, review of #915) — the
// generic guard: every default template the rollback floor's own registry does not seed is new to the floor, which
// may not render its placeholders (the rule-53 class), and that the floor's queue cannot exclude by name. Each one
// must be seeded manual on an anchor the floor's queue never matches — never on `start` — or be declared safe for
// the floor below, with the reason. A new template that forgets its anchor fails here, before any release, whether
// it is sent on an event or on a date.
const test = require('node:test');
const assert = require('node:assert/strict');

const { DEFAULT_TEMPLATES } = require('../utils/defaultEmailTemplatesRegistry');
const { localIsoDate } = require('../utils/localDate');
const { freshDb, seedProperty } = require('./guestEmailSequenceFixtures');
const { FLOOR_TEMPLATE_KEYS, FLOOR_QUEUE_ANCHORS, floorQueue } = require('./rollbackFloorQueue');

// New default templates the floor may offer, each with why that is harmless. None today.
const DECLARED_SAFE_FOR_FLOOR = Object.freeze({});

// The default templates new to the floor that its queue could still offer, each with the reason.
function floorRisks(templates) {
  return templates
    .filter((t) => !FLOOR_TEMPLATE_KEYS.includes(t.stableKey))
    .filter((t) => !Object.prototype.hasOwnProperty.call(DECLARED_SAFE_FOR_FLOOR, t.stableKey))
    .flatMap((t) => {
      if (t.sendMode !== 'manual') return [`${t.stableKey}: seeded '${t.sendMode}', not manual`];
      if (!t.anchor) return [`${t.stableKey}: no anchor, the seed writes 'start'`];
      if (FLOOR_QUEUE_ANCHORS.includes(t.anchor)) return [`${t.stableKey}: on '${t.anchor}', an anchor the floor's queue matches`];
      return [];
    });
}

const newToFloor = DEFAULT_TEMPLATES.map((t) => t.stableKey).filter((key) => !FLOOR_TEMPLATE_KEYS.includes(key));

test('rule 43 (R11 N1) - the templates new to the floor are the ones this release added', () => {
  assert.ok(newToFloor.includes('installment_request'));
  assert.ok(newToFloor.includes('dates_unavailable_notice'));
  for (const key of Object.keys(DECLARED_SAFE_FOR_FLOOR)) assert.ok(newToFloor.includes(key), `${key} is declared safe but the floor already knows it`);
});

test('rule 43 (R11 N1) - no default template new to the floor sits on an anchor its queue reads', () => {
  assert.deepEqual(floorRisks(DEFAULT_TEMPLATES), []);
});

test('rule 43 (review of #915) - a future date-driven template new to the floor is caught, not only an event one', () => {
  const future = [
    ...DEFAULT_TEMPLATES,
    { stableKey: 'stay_reminder_3d', sendMode: 'manual', anchor: 'start' },
    { stableKey: 'stay_unanchored', sendMode: 'manual' },
    { stableKey: 'deposit_nudge', sendMode: 'manual', anchor: 'depositDueDate' },
    { stableKey: 'auto_hello', sendMode: 'auto', anchor: 'created' },
  ];
  assert.deepEqual(floorRisks(future), [
    "stay_reminder_3d: on 'start', an anchor the floor's queue matches",
    "stay_unanchored: no anchor, the seed writes 'start'",
    "deposit_nudge: on 'depositDueDate', an anchor the floor's queue matches",
    "auto_hello: seeded 'auto', not manual",
  ]);
});

test('rule 43 (R11 N1) - over a seeded install, the floor offers none of them for a stay arriving today', () => {
  const db = freshDb();
  const propertyId = seedProperty(db);
  const today = localIsoDate(new Date());
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'A', 'B')").run();
  db.prepare("INSERT INTO reservations (clientId, propertyId, startDate, endDate, kind) VALUES (1, ?, ?, date(?, '+3 days'), 'reservation')").run(propertyId, today, today);
  db.prepare(`UPDATE email_templates SET enabled = 1 WHERE stableKey IN (${newToFloor.map(() => '?').join(', ')})`).run(...newToFloor);
  const offered = floorQueue(db, today);
  for (const key of newToFloor) assert.ok(!offered.includes(key) || key in DECLARED_SAFE_FOR_FLOOR, key);
});
