/**
 * Provider-neutral payment links (specs/plugins-phase-3a-online-payment.md rules 6, 8, 20).
 *
 * Qonto is one payment provider among possible others: its two id columns get neutral twins
 * (`providerLinkId`, `providerPaymentId`), every existing row is a Qonto one, and a link GuestFlow
 * abandoned but could not deactivate remotely carries `remoteCancelPendingAt` until the poll manages it.
 *
 * The migration is ADDITIVE (specs/self-update-and-releases.md rule 31: an automatic rollback does not
 * restore the database, so the previous release must still run on the migrated schema). The legacy
 * columns `qontoPaymentLinkId` / `qontoPaymentId` stay, and `syncLegacyQontoColumns` keeps each pair
 * equal in both directions, so v3.18 code writing the old names and this code writing the new ones both
 * see consistent rows. Idempotent: nothing is written once the pairs are in step.
 */
const PAIRS = [
  ['qontoPaymentLinkId', 'providerLinkId'],
  ['qontoPaymentId', 'providerPaymentId'],
];

const columnsOf = (db) => db.prepare('PRAGMA table_info(payment_links)').all().map((c) => c.name);

function migratePaymentLinksToProviders(db) {
  let cols = columnsOf(db);
  if (cols.length === 0) return;
  for (const [legacy, neutral] of PAIRS) {
    if (cols.includes(neutral)) continue;
    db.exec(`ALTER TABLE payment_links ADD COLUMN ${neutral} TEXT`);
    if (cols.includes(legacy)) db.exec(`UPDATE payment_links SET ${neutral} = ${legacy}`);
  }
  cols = columnsOf(db);
  if (!cols.includes('provider')) db.exec("ALTER TABLE payment_links ADD COLUMN provider TEXT NOT NULL DEFAULT 'qonto'");
  if (!cols.includes('remoteCancelPendingAt')) db.exec('ALTER TABLE payment_links ADD COLUMN remoteCancelPendingAt TEXT');
  // Rule 24 — why GuestFlow abandoned the link: 'settled' when its bucket was paid another way (rule 23).
  if (!cols.includes('cancelReason')) db.exec('ALTER TABLE payment_links ADD COLUMN cancelReason TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_payment_links_provider ON payment_links(provider, providerLinkId)');
}

/**
 * Keeps `qonto*` and `provider*` equal. Must run after every rebuild of `payment_links` (a `DROP TABLE`
 * takes the triggers with it). Rows written by the previous release while it ran on this schema (it only
 * knows the legacy names) are copied across, so a roll-back-then-forward loses nothing.
 */
function syncLegacyQontoColumns(db) {
  let cols = columnsOf(db);
  if (cols.length === 0) return;
  for (const [legacy] of PAIRS) {
    if (!cols.includes(legacy)) db.exec(`ALTER TABLE payment_links ADD COLUMN ${legacy} TEXT`);
  }
  for (const [legacy, neutral] of PAIRS) {
    db.exec(`UPDATE payment_links SET ${legacy} = ${neutral} WHERE ${legacy} IS NULL AND ${neutral} IS NOT NULL`);
    db.exec(`UPDATE payment_links SET ${neutral} = ${legacy} WHERE ${neutral} IS NULL AND ${legacy} IS NOT NULL`);
  }
  const insertWhen = PAIRS.map(([l, n]) => `NEW.${l} IS NOT NEW.${n}`).join(' OR ');
  const insertSet = PAIRS.map(([l, n]) => `${l} = COALESCE(NEW.${n}, NEW.${l}), ${n} = COALESCE(NEW.${n}, NEW.${l})`).join(', ');
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_payment_links_legacy_insert AFTER INSERT ON payment_links
    WHEN ${insertWhen}
    BEGIN UPDATE payment_links SET ${insertSet} WHERE id = NEW.id; END`);
  // One UPDATE changing both names of a pair: the neutral column wins (current code writes it).
  for (const [legacy, neutral] of PAIRS) {
    const toNeutral = `trg_payment_links_${legacy}_to_${neutral}`;
    const toLegacy = `trg_payment_links_${neutral}_to_${legacy}`;
    db.exec(`DROP TRIGGER IF EXISTS ${toNeutral}; DROP TRIGGER IF EXISTS ${toLegacy};`);
    db.exec(`
      CREATE TRIGGER ${toNeutral} AFTER UPDATE OF ${legacy} ON payment_links
      WHEN NEW.${legacy} IS NOT OLD.${legacy} AND NEW.${neutral} IS OLD.${neutral} AND NEW.${neutral} IS NOT NEW.${legacy}
      BEGIN UPDATE payment_links SET ${neutral} = NEW.${legacy} WHERE id = NEW.id; END`);
    db.exec(`
      CREATE TRIGGER ${toLegacy} AFTER UPDATE OF ${neutral} ON payment_links
      WHEN NEW.${neutral} IS NOT OLD.${neutral} AND NEW.${legacy} IS NOT NEW.${neutral}
      BEGIN UPDATE payment_links SET ${legacy} = NEW.${neutral} WHERE id = NEW.id; END`);
  }
}

/**
 * specs/payment-link-lifecycle.md rules 19, 20 — when a lapsed link's last payment read is due, and when
 * the admin was told its deactivation keeps failing. Additive and idempotent; runs after the installments
 * rebuild of `payment_links`, which only copies the columns it knows.
 */
function migrateLinkLifecycleColumns(db) {
  const cols = columnsOf(db);
  if (cols.length === 0) return;
  if (!cols.includes('lastLookAt')) db.exec('ALTER TABLE payment_links ADD COLUMN lastLookAt TEXT');
  if (!cols.includes('deactivationAlertedAt')) db.exec('ALTER TABLE payment_links ADD COLUMN deactivationAlertedAt TEXT');
  // Rules 43, 64 (review of #912) — a link withdrawn for taken dates records the stay that took them, when a read made
  // after its deactivation found it unpaid, and when the guest notice judged it (told, or never to be told).
  if (!cols.includes('takenByReservationId')) db.exec('ALTER TABLE payment_links ADD COLUMN takenByReservationId INTEGER');
  if (!cols.includes('unpaidReadAt')) db.exec('ALTER TABLE payment_links ADD COLUMN unpaidReadAt TEXT');
  if (!cols.includes('noticeJudgedAt')) db.exec('ALTER TABLE payment_links ADD COLUMN noticeJudgedAt TEXT');
}

module.exports = { migratePaymentLinksToProviders, syncLegacyQontoColumns, migrateLinkLifecycleColumns };
