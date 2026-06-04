const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const platformsModel = require('../models/platformsModel');

// accounting-platform-commission-and-no-deposit.md §3.1 + §7.1.
// Plain :memory: fixture for the per-platform commission config.

const DDL = `
  CREATE TABLE ical_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platformLabel TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE platforms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    commissionAccountNumber TEXT,
    hasVatOnCommission INTEGER NOT NULL DEFAULT 0
  );
`;

function freshModel({ seedIcal = [] } = {}) {
  const db = new Database(':memory:');
  db.exec(DDL);
  for (const label of seedIcal) {
    db.prepare('INSERT INTO ical_sources (platformLabel) VALUES (?)').run(label);
  }
  // Mirror what database.js does at boot: 'direct' row + seed from iCal labels.
  db.prepare("INSERT OR IGNORE INTO platforms (name) VALUES ('direct')").run();
  db.exec("INSERT OR IGNORE INTO platforms (name) SELECT DISTINCT platformLabel FROM ical_sources WHERE platformLabel != ''");
  return { model: platformsModel.create(db), db };
}

test('platforms table is created with Direct row + auto-seeded from iCal sources', () => {
  const { model } = freshModel({ seedIcal: ['Airbnb', 'Gîtes de France', 'Airbnb'] });
  const rows = model.listAll();
  const names = rows.map((r) => r.name);
  // Direct is forced to the top via the ORDER BY.
  assert.equal(names[0], 'direct');
  // Then the deduped iCal labels (sorted ASC, case-insensitive).
  assert.deepEqual(names.slice(1).sort(), ['Airbnb', 'Gîtes de France']);
});

test('findByName matches case-sensitive on the stored name; upsertByName is idempotent', () => {
  const { model } = freshModel({ seedIcal: ['Airbnb'] });
  assert.ok(model.findByName('Airbnb'));
  assert.equal(model.findByName('nonsense'), null);
  // Idempotent: upsert of an existing name doesn't duplicate.
  const before = model.listAll().length;
  model.upsertByName('Airbnb');
  assert.equal(model.listAll().length, before);
  // Fresh name lands a new row.
  const created = model.upsertByName('Booking');
  assert.ok(created);
  assert.equal(model.listAll().length, before + 1);
});

test('update writes the per-platform config + leaves Direct untouched (rule 18)', () => {
  const { model } = freshModel({ seedIcal: ['Airbnb', 'Gîtes de France'] });
  const gdf = model.findByName('Gîtes de France');
  const updated = model.update({
    id: gdf.id,
    commissionAccountNumber: '62260500',
    hasVatOnCommission: 1,
  });
  assert.equal(updated.commissionAccountNumber, '62260500');
  assert.equal(updated.hasVatOnCommission, 1);

  // Direct row: write is silently dropped — returns the unchanged row.
  const direct = model.findByName('direct');
  const direct2 = model.update({
    id: direct.id,
    commissionAccountNumber: '99999999',
    hasVatOnCommission: 1,
  });
  assert.equal(direct2.commissionAccountNumber, null);
  assert.equal(direct2.hasVatOnCommission, 0);
});

test('upsertByName ignores empty / whitespace-only names', () => {
  const { model } = freshModel();
  const before = model.listAll().length;
  assert.equal(model.upsertByName(''), null);
  assert.equal(model.upsertByName('   '), null);
  assert.equal(model.upsertByName(null), null);
  assert.equal(model.listAll().length, before);
});

test('listAll order: Direct first, then platforms sorted case-insensitively', () => {
  const { model } = freshModel({ seedIcal: ['Zoo', 'aardvark', 'Beta'] });
  const names = model.listAll().map((r) => r.name);
  assert.equal(names[0], 'direct');
  assert.deepEqual(names.slice(1), ['aardvark', 'Beta', 'Zoo']);
});

test('rescan unions ical_sources + reservations.platform (idempotent, returns inserted count)', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE ical_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, platformLabel TEXT NOT NULL DEFAULT '');
    CREATE TABLE reservations (id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT);
    CREATE TABLE platforms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      commissionAccountNumber TEXT,
      hasVatOnCommission INTEGER NOT NULL DEFAULT 0
    );
  `);
  db.prepare('INSERT INTO ical_sources (platformLabel) VALUES (?)').run('Airbnb');
  db.prepare('INSERT INTO ical_sources (platformLabel) VALUES (?)').run('Booking');
  db.prepare('INSERT INTO reservations (platform) VALUES (?)').run('Airbnb');     // duplicate of iCal label
  db.prepare('INSERT INTO reservations (platform) VALUES (?)').run('Greengo');    // new platform via manual reservation
  db.prepare('INSERT INTO reservations (platform) VALUES (?)').run('direct');     // excluded (case-insensitive)
  db.prepare('INSERT INTO reservations (platform) VALUES (?)').run('Direct');     // excluded
  db.prepare('INSERT INTO reservations (platform) VALUES (?)').run('');           // excluded (empty)
  db.prepare("INSERT INTO platforms (name) VALUES ('direct')").run();
  const model = platformsModel.create(db);

  const inserted = model.rescan();
  // 3 new rows: Airbnb, Booking (iCal), Greengo (reservation). 'direct' and empty skipped.
  assert.equal(inserted, 3);
  const names = model.listAll().map((p) => p.name).sort();
  assert.deepEqual(names, ['Airbnb', 'Booking', 'Greengo', 'direct']);

  // Re-run: idempotent, returns 0.
  assert.equal(model.rescan(), 0);
});
