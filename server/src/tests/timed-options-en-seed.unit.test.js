// EN translation seeding for the early-check-in / late-check-out typed defaults.
// See specs/devis-english-language.md §3 rule 6.
//
// The 2 timed-default options are seeded per-property by `ensureDefaultTimedOptionsForProperty`
// in `database.js`. Because that helper is bound to the production DB at module load time, we
// re-implement its core path here in isolation against an in-memory schema — keeps the test
// focused on the EN backfill / EN insert behaviour without booting the whole database module.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

// Mirror of the production seed (database.js:1262+) — kept small and readable so the test
// communicates intent without duplicating the legacy-upgrade branch we don't care about here.
function seedTimedDefaults(db, propertyId) {
  const cols = db.prepare("PRAGMA table_info(options)").all().map((c) => c.name);
  const hasTitleEn = cols.includes('titleEn');

  const DEFAULTS = [
    { autoOptionType: 'early_check_in', title: 'Arrivée anticipée', titleEn: 'Early check-in', description: '', autoEnabled: 1, autoPricingMode: 'proportional', autoFullNightThreshold: '10:00' },
    { autoOptionType: 'late_check_out', title: 'Départ tardif',     titleEn: 'Late check-out', description: '', autoEnabled: 1, autoPricingMode: 'proportional', autoFullNightThreshold: '17:00' },
  ];

  const findScoped = db.prepare(`
    SELECT o.id${hasTitleEn ? ', o.titleEn' : ''}
    FROM options o
    INNER JOIN property_options po ON po.optionId = o.id
    WHERE po.propertyId = ? AND o.autoOptionType = ?
    LIMIT 1
  `);
  const insertOpt = db.prepare(hasTitleEn
    ? `INSERT INTO options (title, description, priceType, price, autoOptionType, autoEnabled, autoPricingMode, autoFullNightThreshold, titleEn)
       VALUES (?, ?, 'per_stay', 0, ?, ?, ?, ?, ?)`
    : `INSERT INTO options (title, description, priceType, price, autoOptionType, autoEnabled, autoPricingMode, autoFullNightThreshold)
       VALUES (?, ?, 'per_stay', 0, ?, ?, ?, ?)`);
  const linkProp = db.prepare('INSERT OR IGNORE INTO property_options (propertyId, optionId) VALUES (?, ?)');
  const backfillTitleEn = hasTitleEn
    ? db.prepare("UPDATE options SET titleEn = ? WHERE id = ? AND (titleEn IS NULL OR titleEn = '')")
    : null;

  for (const def of DEFAULTS) {
    const existing = findScoped.get(propertyId, def.autoOptionType);
    if (existing) {
      if (backfillTitleEn && (!existing.titleEn || existing.titleEn === '')) {
        backfillTitleEn.run(def.titleEn, Number(existing.id));
      }
      continue;
    }
    const created = hasTitleEn
      ? insertOpt.run(def.title, def.description, def.autoOptionType, def.autoEnabled, def.autoPricingMode, def.autoFullNightThreshold, def.titleEn)
      : insertOpt.run(def.title, def.description, def.autoOptionType, def.autoEnabled, def.autoPricingMode, def.autoFullNightThreshold);
    linkProp.run(propertyId, Number(created.lastInsertRowid));
  }
}

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL, description TEXT DEFAULT '',
      priceType TEXT DEFAULT 'per_stay', price REAL DEFAULT 0,
      autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0, autoPricingMode TEXT DEFAULT 'fixed',
      autoFullNightThreshold TEXT,
      titleEn TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE property_options (propertyId INTEGER NOT NULL, optionId INTEGER NOT NULL, PRIMARY KEY (propertyId, optionId));
  `);
  return db;
}

test('fresh insert: early_check_in is seeded with titleEn = "Early check-in"', () => {
  const db = freshDb();
  seedTimedDefaults(db, 1);
  const row = db.prepare("SELECT title, titleEn FROM options WHERE autoOptionType = 'early_check_in'").get();
  assert.equal(row.title, 'Arrivée anticipée');
  assert.equal(row.titleEn, 'Early check-in');
});

test('fresh insert: late_check_out is seeded with titleEn = "Late check-out"', () => {
  const db = freshDb();
  seedTimedDefaults(db, 1);
  const row = db.prepare("SELECT title, titleEn FROM options WHERE autoOptionType = 'late_check_out'").get();
  assert.equal(row.title, 'Départ tardif');
  assert.equal(row.titleEn, 'Late check-out');
});

test('backfill: existing rows with empty titleEn get the EN title', () => {
  const db = freshDb();
  // Pre-existing rows persisted before the EN column landed (empty titleEn).
  db.prepare(`INSERT INTO options (title, description, autoOptionType, autoEnabled, autoPricingMode, autoFullNightThreshold, titleEn)
              VALUES ('Arrivée anticipée', '', 'early_check_in', 1, 'proportional', '10:00', '')`).run();
  db.prepare(`INSERT INTO options (title, description, autoOptionType, autoEnabled, autoPricingMode, autoFullNightThreshold, titleEn)
              VALUES ('Départ tardif',     '', 'late_check_out', 1, 'proportional', '17:00', '')`).run();
  db.prepare("INSERT INTO property_options (propertyId, optionId) VALUES (1, (SELECT id FROM options WHERE autoOptionType = 'early_check_in'))").run();
  db.prepare("INSERT INTO property_options (propertyId, optionId) VALUES (1, (SELECT id FROM options WHERE autoOptionType = 'late_check_out'))").run();

  seedTimedDefaults(db, 1);

  assert.equal(db.prepare("SELECT titleEn FROM options WHERE autoOptionType = 'early_check_in'").get().titleEn, 'Early check-in');
  assert.equal(db.prepare("SELECT titleEn FROM options WHERE autoOptionType = 'late_check_out'").get().titleEn, 'Late check-out');
});

test('backfill: operator-supplied titleEn is preserved (no overwrite)', () => {
  const db = freshDb();
  db.prepare(`INSERT INTO options (title, description, autoOptionType, autoEnabled, autoPricingMode, autoFullNightThreshold, titleEn)
              VALUES ('Arrivée anticipée', '', 'early_check_in', 1, 'proportional', '10:00', 'Early arrival')`).run();
  db.prepare("INSERT INTO property_options (propertyId, optionId) VALUES (1, (SELECT id FROM options WHERE autoOptionType = 'early_check_in'))").run();

  seedTimedDefaults(db, 1);

  assert.equal(
    db.prepare("SELECT titleEn FROM options WHERE autoOptionType = 'early_check_in'").get().titleEn,
    'Early arrival',
    'operator translation kept intact',
  );
});

test('idempotent: running the seed twice keeps exactly one row per autoOptionType', () => {
  const db = freshDb();
  seedTimedDefaults(db, 1);
  seedTimedDefaults(db, 1);
  const earlyRows = db.prepare("SELECT COUNT(*) AS n FROM options WHERE autoOptionType = 'early_check_in'").get().n;
  const lateRows  = db.prepare("SELECT COUNT(*) AS n FROM options WHERE autoOptionType = 'late_check_out'").get().n;
  assert.equal(earlyRows, 1);
  assert.equal(lateRows, 1);
});
