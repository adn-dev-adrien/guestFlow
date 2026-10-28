/**
 * The VAT regime schema (specs/vat-optional-mode.md rule 22, §5). Idempotent, run on every boot.
 *
 * `vat_periods` is the append-only history of the regime; period 1 is today's behaviour, seeded from
 * `app_settings.vatRate`. Every reservation points at the period it was sold under: the trigger assigns
 * it at insert, whatever the insert path, so none can forget it. Nothing priced or paid is touched —
 * every existing row points at period 1, whose rate is the current rate.
 */

const ASSIGN_SQL = `
  SELECT p.id FROM vat_periods p
  WHERE p.basis = 'all'
     OR (p.basis = 'booking' AND date(:createdAt, 'localtime') >= p.effectiveFrom)
     OR (p.basis = 'arrival' AND :startDate >= p.effectiveFrom)
  ORDER BY p.id DESC LIMIT 1`;

function runVatRegimeMigration(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vat_periods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      regime TEXT NOT NULL CHECK (regime IN ('subject', 'not_subject')),
      rate REAL NOT NULL DEFAULT 0 CHECK (rate >= 0 AND rate <= 100),
      legalMention TEXT CHECK (legalMention IS NULL OR legalMention IN ('art_293_b', 'art_261_d_4')),
      basis TEXT NOT NULL CHECK (basis IN ('all', 'booking', 'arrival')),
      effectiveFrom TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      createdBy INTEGER REFERENCES users(id),
      note TEXT,
      movedFrom TEXT,
      CHECK ((regime = 'subject' AND legalMention IS NULL) OR (regime = 'not_subject' AND rate = 0 AND legalMention IS NOT NULL)),
      CHECK ((basis = 'all') = (effectiveFrom IS NULL))
    )`);

  // Rule 26 — the period each reservation had before a switch moved it, so an unstarted switch undoes exactly.
  if (!db.prepare('PRAGMA table_info(vat_periods)').all().some((c) => c.name === 'movedFrom')) {
    db.exec('ALTER TABLE vat_periods ADD COLUMN movedFrom TEXT');
  }

  const columns = db.prepare('PRAGMA table_info(reservations)').all().map((c) => c.name);
  if (!columns.includes('vatPeriodId')) {
    db.exec('ALTER TABLE reservations ADD COLUMN vatPeriodId INTEGER REFERENCES vat_periods(id)');
  }

  if (!db.prepare('SELECT 1 FROM vat_periods LIMIT 1').get()) {
    const settings = db.prepare('SELECT vatRate FROM app_settings WHERE id = 1').get();
    const rate = settings && settings.vatRate != null ? Number(settings.vatRate) : 10;
    db.prepare("INSERT INTO vat_periods (regime, rate, basis, note) VALUES ('subject', ?, 'all', 'initial')").run(rate);
  }

  const assign = db.prepare(ASSIGN_SQL);
  const orphans = db.prepare('SELECT id, createdAt, startDate FROM reservations WHERE vatPeriodId IS NULL').all();
  if (orphans.length) {
    const set = db.prepare('UPDATE reservations SET vatPeriodId = ? WHERE id = ?');
    db.transaction(() => {
      orphans.forEach((r) => {
        const period = assign.get({ createdAt: r.createdAt, startDate: r.startDate });
        set.run(period ? period.id : 1, r.id);
      });
    })();
  }

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_reservations_vat_period AFTER INSERT ON reservations
    WHEN NEW.vatPeriodId IS NULL
    BEGIN
      UPDATE reservations SET vatPeriodId = COALESCE((
        SELECT p.id FROM vat_periods p
        WHERE p.basis = 'all'
           OR (p.basis = 'booking' AND date(NEW.createdAt, 'localtime') >= p.effectiveFrom)
           OR (p.basis = 'arrival' AND NEW.startDate >= p.effectiveFrom)
        ORDER BY p.id DESC LIMIT 1), (SELECT MIN(id) FROM vat_periods))
      WHERE id = NEW.id;
    END`);

  require('../models/vatRegimeModel').syncMirror(db);
}

module.exports = { runVatRegimeMigration };
