/**
 * Settings rationalization — schema clean-up (specs/settings-rationalization.md §5).
 *
 * Drops the `app_settings` columns nothing reads any more and the stray `payment_methods` table
 * left behind by the reverted payment-method feature. Every step is guarded by `PRAGMA table_info`
 * (or `IF EXISTS`), so re-running it on an already-migrated or fresh database is a no-op.
 *
 * Exports:
 *   DEAD_SETTINGS_COLUMNS — the dropped `app_settings` columns
 *   runSettingsRationalizationMigration(db) → { dropped: string[] }
 */

const DEAD_SETTINGS_COLUMNS = [
  // « Délais & relances » — read by nothing but the form that echoed them (rule 9).
  'paymentDepositReminderOffsets',
  'paymentDepositAbandonOffset',
  'paymentDepositLinkExpiryDays',
  'paymentBalanceReminderOffsets',
  'paymentBalanceAbandonOffset',
  'paymentBalanceLinkExpiryDays',
  // Orphans of PR #178 and of the Google service-account era (rule 10).
  'paymentLastMinuteDays',
  'paymentFullPaymentDueDaysBefore',
  'googleServiceAccountEmail',
  'googleServiceAccountPrivateKey',
  'neatStoreId',
  // Derived from `smtpSecure` at read time (rule 11).
  'smtpPort',
];

function settingsColumns(db) {
  return db.prepare('PRAGMA table_info(app_settings)').all().map((c) => c.name);
}

function runSettingsRationalizationMigration(db) {
  const present = new Set(settingsColumns(db));
  const dropped = [];
  for (const column of DEAD_SETTINGS_COLUMNS) {
    if (!present.has(column)) continue;
    db.exec(`ALTER TABLE app_settings DROP COLUMN ${column}`);
    dropped.push(column);
  }
  db.exec('DROP TABLE IF EXISTS payment_methods');
  return { dropped };
}

module.exports = { DEAD_SETTINGS_COLUMNS, runSettingsRationalizationMigration };
