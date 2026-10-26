// specs/google-vacation-rentals-feed.md rule 17, §7 « Accuracy check: sent amount vs public quote — zero
// mismatch on fixtures; a forced mismatch is reported ». The feed is computed and « sent » in
// simulation over the shipped recipes, then compared with the website's own quote.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const silent = console.log;
console.log = () => {};
const { seed } = require('./gvrFixtures');
const { createSource } = require('../source');
const { createSettings } = require('../settings');
const { buildModel } = require('../model');
const { createGoogleClient } = require('../googleClient');
const { createPushService } = require('../pushService');
const { createAccuracyCheck } = require('../accuracyCheck');
const { memoryStore, DEFAULTS } = require('./memoryStore');

const { db, gite, tente } = seed();
console.log = silent;

const TODAY = '2027-07-03';
const store = memoryStore({
  horizonDays: '30',
  maxLos: '7',
  properties: JSON.stringify({ [gite]: { enabled: true, hotelCode: 'solio-la-granja' }, [tente]: { enabled: true, hotelCode: 'solio-estiva' } }),
}, DEFAULTS);
const settings = createSettings({ store, listProperties: () => db.prepare('SELECT id, name FROM properties').all() });
const model = buildModel(db);
const source = createSource({ db });
let fetched = 0;
const client = createGoogleClient({ mode: settings.mode, dataDir: () => fs.mkdtempSync(path.join(os.tmpdir(), 'gvr-acc-')), fetchImpl: () => { fetched += 1; } });
const push = createPushService({
  settings, model, client, loadState: source.loadState, capacityOf: source.capacityOf, today: () => TODAY, log: { error: () => {} },
});
// A seeded generator: the draws are the same on every run of the suite.
function seeded(seed0) {
  let s = seed0;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}
const check = (random) => createAccuracyCheck({
  settings, model, quoteWebsite: source.quoteWebsite, sizesOf: source.sizesOf, capacityOf: source.capacityOf, today: () => TODAY, random,
});

test.before(async () => {
  const runs = await push.runAll({ full: true, reason: 'full' });
  assert.deepEqual(runs.map((r) => r.result), ['simulated', 'simulated']);
});

test('rule 17 — what was sent equals the website quote: 0 mismatch on 300 stays', () => {
  const result = check(seeded(42)).run({ samples: 300 });
  assert.equal(result.checked, 300);
  assert.deepEqual(result.mismatches, []);
  assert.equal(fetched, 0, 'simulation: nothing left the server');
});

test('rule 17 — a price the website no longer charges is listed with both amounts', () => {
  const [key] = [...model.rateSnapshot(tente).keys()];
  const [checkin, nights, guests] = key.split('|');
  const before = model.rateSnapshot(tente).get(key);
  db.prepare('UPDATE gvr_rate_snapshot SET amountCents = amountCents + 500 WHERE propertyId = ? AND checkin = ? AND nights = ? AND guests = ?')
    .run(tente, checkin, Number(nights), Number(guests));
  try {
    // Every draw hits the one forced row: 0.0 → « from the snapshot », index 0.
    const result = check(() => 0).run({ propertyId: tente, samples: 3 });
    assert.equal(result.mismatches.length, 3);
    assert.deepEqual(result.mismatches[0], {
      propertyId: tente, propertyName: 'L’Estiva', checkin, nights: Number(nights), guests: Number(guests), sent: (before + 500) / 100, website: before / 100,
    });
  } finally {
    db.prepare('UPDATE gvr_rate_snapshot SET amountCents = ? WHERE propertyId = ? AND checkin = ? AND nights = ? AND guests = ?')
      .run(before, tente, checkin, Number(nights), Number(guests));
  }
});

test('rule 17 — a stay the website sells but the feed never sent is listed (sent: null)', () => {
  const saved = db.prepare('SELECT * FROM gvr_rate_snapshot WHERE propertyId = ?').all(tente);
  db.prepare('DELETE FROM gvr_rate_snapshot WHERE propertyId = ?').run(tente);
  try {
    const result = check(seeded(7)).run({ propertyId: tente, samples: 40 });
    assert.ok(result.mismatches.length > 0);
    assert.ok(result.mismatches.every((m) => m.sent === null && m.website > 0));
  } finally {
    const insert = db.prepare('INSERT INTO gvr_rate_snapshot (propertyId, checkin, nights, guests, amountCents, sentAt) VALUES (?, ?, ?, ?, ?, ?)');
    saved.forEach((r) => insert.run(r.propertyId, r.checkin, r.nights, r.guests, r.amountCents, r.sentAt));
  }
});

test('rule 17 — a stay sent but now booked is listed (website: null)', () => {
  const client2 = db.prepare("INSERT INTO clients (lastName, firstName) VALUES ('Test', 'Check')").run().lastInsertRowid;
  const reservation = db.prepare("INSERT INTO reservations (propertyId, clientId, startDate, endDate, kind, checkInTime, checkOutTime) VALUES (?, ?, '2027-07-10', '2027-07-12', 'reservation', '16:00', '10:00')")
    .run(tente, client2).lastInsertRowid;
  try {
    const keys = [...model.rateSnapshot(tente).keys()];
    const index = keys.findIndex((k) => k.startsWith('2027-07-10|2|'));
    assert.ok(index >= 0);
    let calls = 0;
    // First call: « from the snapshot »; second: the index of that stay.
    const random = () => { calls += 1; return calls % 2 === 1 ? 0 : index / keys.length + 1e-9; };
    const result = check(random).run({ propertyId: tente, samples: 1 });
    assert.equal(result.mismatches.length, 1);
    assert.equal(result.mismatches[0].website, null);
    assert.ok(result.mismatches[0].sent > 0);
  } finally {
    db.prepare('DELETE FROM reservations WHERE id = ?').run(reservation);
  }
});

test('the samples are shared between the enabled properties, and bounded', () => {
  const a = check(seeded(1)).run({ samples: 5 });
  assert.equal(a.checked, 5);
  assert.equal(check(seeded(1)).run({ samples: 1e9 }).checked, 2000);
});
