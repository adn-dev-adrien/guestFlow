const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runForceExtrasComplementOnPlatform } = require('../utils/forceExtrasComplementOnPlatformMigration');

// specs/force-extras-complement-on-platform.md §3 rule 6 + §7.1.
// Plain :memory: fixture with the 4 tables the migration touches.

const DDL = `
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT
  );
  CREATE TABLE reservation_options (
    reservationId INTEGER NOT NULL,
    optionId INTEGER NOT NULL,
    inComplement INTEGER NOT NULL DEFAULT 0,
    acompteContribTtc REAL,
    soldeContribTtc REAL,
    PRIMARY KEY (reservationId, optionId)
  );
  CREATE TABLE reservation_custom_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reservationId INTEGER NOT NULL,
    inComplement INTEGER NOT NULL DEFAULT 0,
    acompteContribTtc REAL,
    soldeContribTtc REAL
  );
  CREATE TABLE reservation_resources (
    reservationId INTEGER NOT NULL,
    resourceId INTEGER NOT NULL,
    inComplement INTEGER NOT NULL DEFAULT 0,
    acompteContribTtc REAL,
    soldeContribTtc REAL,
    PRIMARY KEY (reservationId, resourceId)
  );
`;

function freshDb() {
  const db = new Database(':memory:');
  db.exec(DDL);
  // Seed: 1 direct + 2 non-direct, each with one of every extra type, all NOT
  // already in complement and carrying contribs to be nulled.
  db.prepare("INSERT INTO reservations (id, platform) VALUES (1, 'direct')").run();
  db.prepare("INSERT INTO reservations (id, platform) VALUES (2, 'Airbnb')").run();
  db.prepare("INSERT INTO reservations (id, platform) VALUES (3, 'GitesDeFrance')").run();
  // Reservation 1 (direct): one of each, default-zero inComplement, no contribs.
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, inComplement) VALUES (1, 11, 0)').run();
  db.prepare('INSERT INTO reservation_custom_options (reservationId, inComplement) VALUES (1, 0)').run();
  db.prepare('INSERT INTO reservation_resources (reservationId, resourceId, inComplement) VALUES (1, 21, 0)').run();
  // Reservation 2 (Airbnb): one of each, inComplement=0, contribs set (legacy data).
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, inComplement, acompteContribTtc, soldeContribTtc) VALUES (2, 12, 0, 5.0, 10.0)').run();
  db.prepare('INSERT INTO reservation_custom_options (reservationId, inComplement, acompteContribTtc, soldeContribTtc) VALUES (2, 0, 3.0, 6.0)').run();
  db.prepare('INSERT INTO reservation_resources (reservationId, resourceId, inComplement, acompteContribTtc, soldeContribTtc) VALUES (2, 22, 0, 2.0, 4.0)').run();
  // Reservation 3 (GitesDeFrance): one of each, default-zero, no contribs.
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, inComplement) VALUES (3, 13, 0)').run();
  db.prepare('INSERT INTO reservation_custom_options (reservationId, inComplement) VALUES (3, 0)').run();
  db.prepare('INSERT INTO reservation_resources (reservationId, resourceId, inComplement) VALUES (3, 23, 0)').run();
  return db;
}

test('migrates only non-direct reservations (sets inComplement = 1 on platform extras, leaves direct alone)', () => {
  const db = freshDb();
  const result = runForceExtrasComplementOnPlatform(db);

  // 6 lines (2 reservations × 3 tables) on platform reservations.
  assert.equal(result.affectedLines, 6);
  assert.equal(result.affectedReservations, 2);

  // Direct (id=1): still 0 on every extra.
  const direct = {
    opt: db.prepare('SELECT inComplement FROM reservation_options WHERE reservationId = 1').get(),
    custom: db.prepare('SELECT inComplement FROM reservation_custom_options WHERE reservationId = 1').get(),
    res: db.prepare('SELECT inComplement FROM reservation_resources WHERE reservationId = 1').get(),
  };
  assert.equal(direct.opt.inComplement, 0);
  assert.equal(direct.custom.inComplement, 0);
  assert.equal(direct.res.inComplement, 0);

  // Platforms (id=2 + id=3): all flipped to 1.
  for (const id of [2, 3]) {
    const opt = db.prepare('SELECT inComplement FROM reservation_options WHERE reservationId = ?').get(id);
    const custom = db.prepare('SELECT inComplement FROM reservation_custom_options WHERE reservationId = ?').get(id);
    const res = db.prepare('SELECT inComplement FROM reservation_resources WHERE reservationId = ?').get(id);
    assert.equal(opt.inComplement, 1, `reservation ${id} option not flipped`);
    assert.equal(custom.inComplement, 1, `reservation ${id} custom option not flipped`);
    assert.equal(res.inComplement, 1, `reservation ${id} resource not flipped`);
  }
});

test('nulls both contribs on every migrated extra row across the 3 tables', () => {
  const db = freshDb();
  runForceExtrasComplementOnPlatform(db);

  // Reservation 2 had non-null contribs on every table — must now be NULL.
  const opt = db.prepare('SELECT acompteContribTtc, soldeContribTtc FROM reservation_options WHERE reservationId = 2').get();
  const custom = db.prepare('SELECT acompteContribTtc, soldeContribTtc FROM reservation_custom_options WHERE reservationId = 2').get();
  const res = db.prepare('SELECT acompteContribTtc, soldeContribTtc FROM reservation_resources WHERE reservationId = 2').get();

  assert.equal(opt.acompteContribTtc, null);
  assert.equal(opt.soldeContribTtc, null);
  assert.equal(custom.acompteContribTtc, null);
  assert.equal(custom.soldeContribTtc, null);
  assert.equal(res.acompteContribTtc, null);
  assert.equal(res.soldeContribTtc, null);
});

test('idempotent — second run reports 0 affected', () => {
  const db = freshDb();
  const first = runForceExtrasComplementOnPlatform(db);
  assert.equal(first.affectedLines, 6);

  const second = runForceExtrasComplementOnPlatform(db);
  assert.equal(second.affectedLines, 0);
  assert.equal(second.affectedReservations, 0);
});

test('preserves rows that were already inComplement = 1 — no double-write', () => {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare("INSERT INTO reservations (id, platform) VALUES (1, 'Airbnb')").run();
  // Pre-flipped row with non-null contribs — those contribs MUST NOT be touched, even
  // though the new write-time rule would have nulled them on a fresh write. Migration
  // only touches rows where inComplement = 0.
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, inComplement, acompteContribTtc, soldeContribTtc) VALUES (1, 11, 1, 99.0, 88.0)').run();

  const result = runForceExtrasComplementOnPlatform(db);
  assert.equal(result.affectedLines, 0);
  assert.equal(result.affectedReservations, 0);

  const opt = db.prepare('SELECT inComplement, acompteContribTtc, soldeContribTtc FROM reservation_options WHERE reservationId = 1').get();
  assert.equal(opt.inComplement, 1);
  assert.equal(opt.acompteContribTtc, 99.0);
  assert.equal(opt.soldeContribTtc, 88.0);
});

test('captured-contrib warning logged when a non-null acompteContribTtc is found on a non-direct reservation', () => {
  const db = freshDb();
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (msg) => warnings.push(String(msg));
  try {
    runForceExtrasComplementOnPlatform(db);
  } finally {
    console.warn = originalWarn;
  }
  // Reservation 2 has non-null acompteContribTtc on the 3 tables → 3 warnings, all
  // pinned to that reservation id. Reservation 3 has NULL contribs → no warning.
  const r2Warns = warnings.filter((w) => w.includes('reservation #2'));
  const r3Warns = warnings.filter((w) => w.includes('reservation #3'));
  assert.equal(r2Warns.length, 3);
  assert.equal(r3Warns.length, 0);
  // The format the operator sees in the log.
  assert.ok(/had captured acompte contribs on extras in reservation_options/.test(r2Warns.join('\n')));
  assert.ok(/had captured acompte contribs on extras in reservation_custom_options/.test(r2Warns.join('\n')));
  assert.ok(/had captured acompte contribs on extras in reservation_resources/.test(r2Warns.join('\n')));
});

test('empty / NULL platform = direct (no forcing)', () => {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare("INSERT INTO reservations (id, platform) VALUES (1, '')").run();
  db.prepare("INSERT INTO reservations (id, platform) VALUES (2, NULL)").run();
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, inComplement) VALUES (1, 11, 0)').run();
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, inComplement) VALUES (2, 22, 0)').run();

  const result = runForceExtrasComplementOnPlatform(db);
  assert.equal(result.affectedLines, 0);
  assert.equal(result.affectedReservations, 0);
  // Both reservations' extras stay at inComplement = 0.
  assert.equal(db.prepare('SELECT inComplement FROM reservation_options WHERE reservationId = 1').get().inComplement, 0);
  assert.equal(db.prepare('SELECT inComplement FROM reservation_options WHERE reservationId = 2').get().inComplement, 0);
});
