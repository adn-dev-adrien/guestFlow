/**
 * Settings rationalization — schema and data migration (specs/settings-rationalization.md §5).
 *
 * Three steps, in this order, every one safe to re-run:
 *   1. Email identity (rule 12) — once, recorded in `migrations`: a sending address, SMTP login,
 *      sender name or notification recipient equal to what it now falls back to is blanked, so it
 *      becomes « derived ». No effective value changes, except a sender name still on the old
 *      'GuestFlow' default, which now follows the company name.
 *   2. Automatic sending (rule 17b) — once, recorded in `migrations`, BEFORE the master switch
 *      disappears: unless the switch was explicitly ON, every template goes back to « manual ». The
 *      sequence templates were stored « auto » and only the switch held them back; a database that
 *      never had the switch is treated as OFF — the safe default is « ask me ».
 *   3. Drops the `app_settings` columns nothing reads any more and the stray `payment_methods`
 *      table left behind by the reverted payment-method feature.
 *
 * Exports:
 *   DEAD_SETTINGS_COLUMNS — the dropped `app_settings` columns
 *   runSettingsRationalizationMigration(db) → { identityNormalised, templatesSetToManual, dropped }
 */

const { resolveEmailIdentity } = require('./emailIdentity');

const IDENTITY_MIGRATION = 'settings_email_identity_v1';
const AUTO_SEND_MIGRATION = 'settings_auto_send_per_template_v1';

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
  // Replaced by a per-reservation unlock (rule 17a).
  'allowEditPastReservations',
  // Replaced by each template's own mode (rule 17b) — dropped after step 2.
  'emailAutoSendEnabled',
];

function columnsOf(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

function tableExists(db, table) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

function normaliseEmailIdentity(db) {
  if (!tableExists(db, 'migrations')) return false;
  if (db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(IDENTITY_MIGRATION)) return false;
  const row = db.prepare('SELECT * FROM app_settings WHERE id = 1').get();
  if (row) {
    const next = { ...row };
    if (same(next.smtpFromEmail, next.companyEmail)) next.smtpFromEmail = '';
    const fromEmail = resolveEmailIdentity(next).fromEmail;
    if (same(next.smtpUsername, fromEmail)) next.smtpUsername = '';
    if (same(next.notificationRecipientEmail, fromEmail)) next.notificationRecipientEmail = '';
    if (same(next.smtpFromName, next.companyName) || String(next.smtpFromName || '').trim() === 'GuestFlow') {
      next.smtpFromName = '';
    }
    db.prepare(`
      UPDATE app_settings
         SET smtpFromEmail = ?, smtpUsername = ?, notificationRecipientEmail = ?, smtpFromName = ?
       WHERE id = 1
    `).run(next.smtpFromEmail || '', next.smtpUsername || '', next.notificationRecipientEmail || '', next.smtpFromName || '');
  }
  db.prepare('INSERT INTO migrations (name) VALUES (?)').run(IDENTITY_MIGRATION);
  return Boolean(row);
}

function templatesBackToManual(db, settingsColumns) {
  if (!tableExists(db, 'migrations') || !tableExists(db, 'email_templates')) return 0;
  if (db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(AUTO_SEND_MIGRATION)) return 0;
  let switchOn = false;
  if (settingsColumns.includes('emailAutoSendEnabled')) {
    const row = db.prepare('SELECT emailAutoSendEnabled FROM app_settings WHERE id = 1').get();
    switchOn = Boolean(row) && Number(row.emailAutoSendEnabled) === 1;
  }
  const changes = switchOn
    ? 0
    : db.prepare("UPDATE email_templates SET sendMode = 'manual' WHERE sendMode = 'auto'").run().changes;
  db.prepare('INSERT INTO migrations (name) VALUES (?)').run(AUTO_SEND_MIGRATION);
  return changes;
}

function runSettingsRationalizationMigration(db) {
  const run = db.transaction(() => {
    const identityNormalised = normaliseEmailIdentity(db);
    const templatesSetToManual = templatesBackToManual(db, columnsOf(db, 'app_settings'));
    const present = new Set(columnsOf(db, 'app_settings'));
    const dropped = [];
    for (const column of DEAD_SETTINGS_COLUMNS) {
      if (!present.has(column)) continue;
      db.exec(`ALTER TABLE app_settings DROP COLUMN ${column}`);
      dropped.push(column);
    }
    db.exec('DROP TABLE IF EXISTS payment_methods');
    return { identityNormalised, templatesSetToManual, dropped };
  });
  return run();
}

module.exports = { DEAD_SETTINGS_COLUMNS, IDENTITY_MIGRATION, AUTO_SEND_MIGRATION, runSettingsRationalizationMigration };
