const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { ensureDefaultBedLinenOption, SEED_DEFINITION } = require('../utils/bedLinenSeed');

// Pins the three branches of the seed:
//   - fresh install: inserts the typed option (idempotent on second run).
//   - prod where Adrien already manually created an option + ticked countsAsBedLinen: skipped.
//   - prod with options but none flagged: still inserts.

const NULL_LOGGER = { log() {} };

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      description TEXT,
      priceType TEXT,
      price REAL,
      optionProgressiveTiers TEXT DEFAULT '[]',
      autoOptionType TEXT,
      autoEnabled INTEGER DEFAULT 0,
      autoPricingMode TEXT DEFAULT 'fixed',
      autoFullNightThreshold TEXT,
      countsAsBedLinen INTEGER NOT NULL DEFAULT 0
    );
  `);
  return db;
}

test('seed on a fresh DB: inserts one bed_linen option with the expected shape', () => {
  const db = makeDb();
  const result = ensureDefaultBedLinenOption(db, { logger: NULL_LOGGER });
  assert.equal(result.action, 'seeded');

  const rows = db.prepare("SELECT * FROM options WHERE autoOptionType = 'bed_linen'").all();
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.title, SEED_DEFINITION.title);
  assert.equal(row.autoOptionType, 'bed_linen');
  assert.equal(Number(row.countsAsBedLinen), 1);
  assert.equal(Number(row.autoEnabled), 0, 'auto-add disabled: Adrien picks the option per reservation');
  assert.equal(row.priceType, 'per_stay');
  assert.equal(Number(row.price), 0, 'starts free; Adrien adjusts via the UI');
});

test('seed is idempotent: second call inserts nothing', () => {
  const db = makeDb();
  ensureDefaultBedLinenOption(db, { logger: NULL_LOGGER });
  const result = ensureDefaultBedLinenOption(db, { logger: NULL_LOGGER });
  assert.equal(result.action, 'skipped-already-seeded');
  const n = db.prepare("SELECT COUNT(*) AS n FROM options WHERE autoOptionType = 'bed_linen'").get().n;
  assert.equal(n, 1, 'no duplicate row');
});

test('seed PROMOTES an operator-customised option in place (keeps title/price, adds autoOptionType)', () => {
  // Prod scenario: Adrien had a "Linge personnel" option BEFORE the feature shipped, then
  // upgraded + ticked the new countsAsBedLinen flag. Earlier the seed would skip and leave it
  // deletable; now it promotes the row in place — the operator's customisations stay, but the
  // option becomes undeletable in the UI thanks to the `autoOptionType` marker.
  const db = makeDb();
  db.prepare(
    "INSERT INTO options (title, priceType, price, countsAsBedLinen) VALUES ('Linge personnel', 'per_stay', 12, 1)"
  ).run();

  const result = ensureDefaultBedLinenOption(db, { logger: NULL_LOGGER });
  assert.equal(result.action, 'promoted-adopted');
  assert.equal(result.count, 1);
  // The pre-existing option still has Adrien's name + price, and is now typed.
  const all = db.prepare('SELECT * FROM options ORDER BY id').all();
  assert.equal(all.length, 1, 'no duplicate row inserted');
  assert.equal(all[0].title, 'Linge personnel');
  assert.equal(Number(all[0].price), 12);
  assert.equal(all[0].autoOptionType, 'bed_linen', 'now undeletable in the UI');
});

test('seed PROMOTES multiple adopted options if Adrien runs several flagged variants', () => {
  // Edge case from spec rule 16: nothing forbids carrying the flag on multiple options
  // ("Standard" + "Premium"). All matching rows should be promoted in one pass.
  const db = makeDb();
  db.prepare(
    "INSERT INTO options (title, priceType, price, countsAsBedLinen) VALUES ('Linge de lit Standard', 'per_stay', 0, 1)"
  ).run();
  db.prepare(
    "INSERT INTO options (title, priceType, price, countsAsBedLinen) VALUES ('Linge de lit Premium', 'per_stay', 25, 1)"
  ).run();

  const result = ensureDefaultBedLinenOption(db, { logger: NULL_LOGGER });
  assert.equal(result.action, 'promoted-adopted');
  assert.equal(result.count, 2);
  const all = db.prepare("SELECT * FROM options WHERE autoOptionType = 'bed_linen' ORDER BY id").all();
  assert.equal(all.length, 2);
  assert.deepEqual(all.map((r) => r.title), ['Linge de lit Standard', 'Linge de lit Premium']);
});

test('seed PROMOTES by title alias too: "Linge de lit" exact match (case-insensitive)', () => {
  // Prod scenario Adrien confirmed: he created "Linge de lit" by hand before the feature,
  // never ticked the new flag (the checkbox is hidden in the UI now). The seed must still
  // recognise the option and promote it transparently — no manual cleanup required.
  const db = makeDb();
  db.prepare(
    "INSERT INTO options (title, priceType, price) VALUES ('Linge de lit', 'per_stay', 5)"
  ).run();

  const result = ensureDefaultBedLinenOption(db, { logger: NULL_LOGGER });
  assert.equal(result.action, 'promoted-adopted');
  assert.equal(result.count, 1);
  const row = db.prepare("SELECT * FROM options WHERE title = 'Linge de lit'").get();
  assert.equal(row.autoOptionType, 'bed_linen', 'undeletable marker added');
  assert.equal(Number(row.countsAsBedLinen), 1, 'flag also set so the LaundryDayCard picks it up');
  assert.equal(Number(row.price), 5, 'operator price preserved');
});

test('seed PROMOTES by title alias: "Linge de lits" (plural) — covers Adrien\'s exact prod row', () => {
  // The plural was the specific edge case Adrien flagged — must be promoted without a duplicate.
  const db = makeDb();
  db.prepare(
    "INSERT INTO options (title, priceType, price) VALUES ('Linge de lits', 'per_stay', 8)"
  ).run();

  const result = ensureDefaultBedLinenOption(db, { logger: NULL_LOGGER });
  assert.equal(result.action, 'promoted-adopted');
  const row = db.prepare("SELECT * FROM options WHERE title = 'Linge de lits'").get();
  assert.equal(row.autoOptionType, 'bed_linen');
  assert.equal(Number(row.countsAsBedLinen), 1);
  // Title is NOT rewritten — Adrien's spelling is preserved, only the marker is added.
  assert.equal(row.title, 'Linge de lits');
});

test('seed promotion by title is case-insensitive + trim-tolerant', () => {
  const db = makeDb();
  db.prepare(
    "INSERT INTO options (title, priceType, price) VALUES ('  LINGE DE LIT  ', 'per_stay', 0)"
  ).run();
  const result = ensureDefaultBedLinenOption(db, { logger: NULL_LOGGER });
  assert.equal(result.action, 'promoted-adopted');
});

test('seed does NOT promote an unrelated title (no fuzzy match — only the exact alias list)', () => {
  const db = makeDb();
  db.prepare(
    "INSERT INTO options (title, priceType, price) VALUES ('Drap supplémentaire', 'per_stay', 7)"
  ).run();
  // No countsAsBedLinen flag + title not in aliases → seed inserts a fresh row alongside.
  const result = ensureDefaultBedLinenOption(db, { logger: NULL_LOGGER });
  assert.equal(result.action, 'seeded');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM options").get().n, 2);
});

test('seed does NOT overwrite an adopted option that already has a different autoOptionType', () => {
  // Defensive: a manual `autoOptionType` set to some other value (e.g. a typo or a future
  // type we don't know about yet) MUST be preserved. The promotion only touches NULL / empty.
  const db = makeDb();
  db.prepare(
    "INSERT INTO options (title, priceType, price, autoOptionType, countsAsBedLinen) VALUES ('Custom typed', 'per_stay', 0, 'custom_marker', 1)"
  ).run();

  const result = ensureDefaultBedLinenOption(db, { logger: NULL_LOGGER });
  // No bed_linen row exists → fresh seed path (the "Custom typed" row's marker isn't bed_linen),
  // so the seeder INSERTS a brand-new typed seed alongside. The custom row is left alone.
  assert.equal(result.action, 'seeded');
  const customRow = db.prepare("SELECT * FROM options WHERE title = 'Custom typed'").get();
  assert.equal(customRow.autoOptionType, 'custom_marker', 'custom marker preserved');
  const seedRow = db.prepare("SELECT * FROM options WHERE autoOptionType = 'bed_linen'").get();
  assert.equal(seedRow.title, 'Linge de lit');
});

test('seed inserts even when other unrelated options exist, none flagged', () => {
  // Prod that has options (cleaning, parking, etc.) but no linen flag → seed still runs.
  const db = makeDb();
  db.prepare("INSERT INTO options (title, priceType, price) VALUES ('Ménage', 'per_stay', 80)").run();
  db.prepare("INSERT INTO options (title, priceType, price) VALUES ('Parking', 'per_stay', 10)").run();

  const result = ensureDefaultBedLinenOption(db, { logger: NULL_LOGGER });
  assert.equal(result.action, 'seeded');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM options').get().n, 3);
});

test('seed degrades gracefully when the schema is missing the new column', () => {
  // Defensive: if the seeder runs before the migration block (shouldn't happen, but…), it
  // must not crash. The action tag reflects the skip reason for the boot log.
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      autoOptionType TEXT
      -- countsAsBedLinen intentionally absent
    );
  `);
  const result = ensureDefaultBedLinenOption(db, { logger: NULL_LOGGER });
  assert.equal(result.action, 'skipped-schema');
  // Nothing was inserted.
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM options').get().n, 0);
});

test('seed catches any thrown error and returns { action: "error" }', () => {
  // Pass a fake "database" that throws to confirm the error path. We don't want the boot
  // to crash if SQLite is temporarily misbehaving — the spec keeps the seed best-effort.
  const fake = {
    prepare() {
      throw new Error('SQLITE_BUSY: simulated');
    },
  };
  const result = ensureDefaultBedLinenOption(fake, { logger: NULL_LOGGER });
  assert.equal(result.action, 'error');
  assert.match(result.error, /SQLITE_BUSY/);
});
