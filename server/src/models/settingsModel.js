/**
 * Settings model — sole DB access layer for the `app_settings` singleton row.
 *
 * Exports a default model bound to the production database, and a `create(db)`
 * factory so tests can instantiate a model against an in-memory database.
 *
 * API:
 *   read()                      → full row (defaults applied; SMTP password NEVER returned in clear)
 *   upsert(payload)             → writes only the keys present in payload (per-field 3-way)
 *   updateLogoPath(path)        → single-column update of companyLogoPath
 *   smtpConfigured()            → true when smtpHost AND the resolved sending address are filled
 *   publicUrl()                 → the configured public URL (string, never null)
 *   decryptedSmtpSettings()     → { host, port, secure, user, password, fromEmail, fromName }
 *                                  with the password decrypted on the fly — used by the email
 *                                  service. Never exposed via HTTP.
 */

const db = require('../database');
const { encrypt, decrypt, isEncrypted, safeDecrypt } = require('../utils/encryption');
const { smtpPortForSecure } = require('../utils/settingsValidation');
const { resolveEmailIdentity } = require('../utils/emailIdentity');

// PM2-visible marker emitted when an encrypted value can't be decrypted with the current
// `GUESTFLOW_ENCRYPTION_KEY` — typically because a previous deploy regenerated
// `.env.local` (fixed at the workflow level by PR #96). We surface the column name so
// the operator knows what to re-enter from Paramètres, and we throttle to one warning
// per column per process lifetime so PM2 logs aren't drowned in repeats.
const warnedDecryptCols = new Set();
function warnDecryptFailure(col, reason) {
  if (warnedDecryptCols.has(col)) return;
  warnedDecryptCols.add(col);
  // Single-line marker — easy to grep in PM2 logs.
  // eslint-disable-next-line no-console
  console.warn(`[settingsModel] decrypt failed for "${col}" (${reason}). The current GUESTFLOW_ENCRYPTION_KEY can't decrypt the stored blob. Re-saisis la valeur depuis Paramètres pour la re-chiffrer avec la clé courante.`);
}

// Columns encrypted at rest (AES-256-GCM). The Google, Météo-France, Qonto and Neat secrets moved to
// plugin_settings with their plugins (specs/plugins-phase-1-sdk.md §5, plugins-phase-3a-online-payment.md
// rule 13, plugins-phase-3b-neat.md rule 10); their old columns stay in the table, unread.
const ENCRYPTED_COLUMNS = [
  'smtpPasswordEncrypted',
];

const COLUMNS = [
  'companyName',
  'companyAddress',
  'companyEmail',
  'companyPhone',
  'companySiret',
  'companyTva',
  'companyIban',
  'companyBic',
  'companyBankName',
  'quoteFooterText',
  // English-language footer for the bilingual devis PDF (specs/devis-english-language.md §3 rule 11).
  // Optional — when empty the PDF falls back to a hard-coded English default in devisPdfLabels.
  'quoteFooterTextEn',
  'quoteValidityDays',
  'companyLogoPath',
  'vatRate',
  // The four account and VAT settings of the accounting export (commission account and rate,
  // cancellation-compensation account and rate) live in plugin_settings since
  // specs/plugins-phase-2-hosts.md rule 19; their app_settings columns stay in place, unread.
  // Accounting closing month, 1..12 (specs/fiscal-year-and-nights-sold.md §3.1). Drives every annual
  // window of the Suivi financier. Plain integer — nothing secret, no encryption.
  'fiscalYearEndMonth',
  // Revenue goal per exercise, JSON (specs/finance-dashboard-redesign.md §3.8). Validated and merged
  // by the settings controller through utils/revenueGoals.js.
  'revenueGoals',
  // SMTP for the account-management flow (specs/admin-account-management.md). The password column
  // stores the AES-256-GCM ciphertext; the model masks it on read and exposes a boolean flag
  // (smtpPasswordSet) so the client never sees the cleartext or the ciphertext blob.
  'smtpHost',
  'smtpSecure',
  'smtpUsername',
  'smtpPasswordEncrypted',
  'smtpFromEmail',
  'smtpFromName',
  'publicUrl',
  // Domain gate/access code shown on the arrival SAS (specs/arrival-departure-sas.md §3.5). Global.
  'portalCode',
  // Booking notifications (specs/site-booking-notifications.md §5). Non-secret. `notificationsEnabled`
  // is the master switch (INTEGER 0/1, default 1); `notificationRecipientEmail` is the TO address
  // (empty → falls back to smtpFromEmail). The email link reuses `publicUrl`.
  'notificationsEnabled',
  'notificationRecipientEmail',
  // Per-channel switch for the new-iCal-reservation email (INTEGER 0/1, default 1). See spec §3 rule 9b.
  'notifyIcalReservationEnabled',
  // Guest email sequence (specs/guest-email-sequence.md §5). `guestSequenceStartDate` is written once,
  // by the email-templates controller, the first time a sequence template goes « auto »: no sequence email
  // dated before it is ever sent. The rest feeds the email copy.
  'guestSequenceStartDate',
  'googleReviewUrl',
  'instagramUrl',
  'poolSeasonStart',
  'poolSeasonEnd',
  // The public website's origin: the CGV link of the emails and the return page of an online payment
  // (specs/plugins-phase-3a-online-payment.md rule 15). The 20 Qonto columns moved to the
  // online-payment plugin's settings (rule 13); they stay in the table, unread.
  'publicSiteOrigin',
];

const NUMERIC_DEFAULTS = {
  quoteValidityDays: 30,
  vatRate: 10,
  smtpSecure: 0,
  notificationsEnabled: 1,
  notifyIcalReservationEnabled: 1,
};

const STRING_DEFAULT_OVERRIDES = {
  poolSeasonStart: '06-15',
  poolSeasonEnd: '08-31',
};

const DEFAULTS = COLUMNS.reduce((acc, col) => {
  if (Object.prototype.hasOwnProperty.call(NUMERIC_DEFAULTS, col)) acc[col] = NUMERIC_DEFAULTS[col];
  else if (Object.prototype.hasOwnProperty.call(STRING_DEFAULT_OVERRIDES, col)) acc[col] = STRING_DEFAULT_OVERRIDES[col];
  else acc[col] = '';
  return acc;
}, { createdAt: null, updatedAt: null });

// Columns the client may NEVER see (encrypted blobs). We expose a `*Set` boolean mask instead so
// the UI knows whether to show "Modifier" on a MaskedTextField vs. "Configurer".
const HTTP_MASKED_COLUMNS = {
  smtpPasswordEncrypted: 'smtpPasswordSet',
};

function createSettingsModel(databaseInstance) {
  // Filter `COLUMNS` against the actual `app_settings` schema so the model survives test DBs
  // (and partially-migrated prod DBs) that haven't yet added a column from the canonical list.
  // The 2026-06-06 addition of `quoteFooterTextEn` is the prompting example — previously a
  // missing column here would crash every test that builds its own in-memory schema.
  const actualCols = new Set(
    databaseInstance.prepare("PRAGMA table_info(app_settings)").all().map((c) => c.name),
  );
  const presentCols = COLUMNS.filter((c) => actualCols.has(c));
  // Same schema-resilience for the encrypted set: a test/partial schema may not carry every
  // encrypted column (e.g. the Qonto token columns), so migrateEncryption must skip the absent ones.
  const presentEncryptedCols = ENCRYPTED_COLUMNS.filter((c) => actualCols.has(c));
  const readStmt = databaseInstance.prepare(
    `SELECT ${presentCols.join(', ')}${actualCols.has('createdAt') ? ', createdAt' : ''}${actualCols.has('updatedAt') ? ', updatedAt' : ''} FROM app_settings WHERE id = 1`
  );

  const updateLogoStmt = databaseInstance.prepare(
    `UPDATE app_settings SET companyLogoPath = ?, updatedAt = datetime('now') WHERE id = 1`
  );

  function readRaw() {
    const row = readStmt.get();
    if (!row) return { ...DEFAULTS };
    return row;
  }

  return {
    // Reads the row, decrypts the non-masked columns, masks the masked ones. Safe to expose via HTTP.
    read() {
      const row = readRaw();
      const out = { ...row };
      for (const col of ENCRYPTED_COLUMNS) {
        if (HTTP_MASKED_COLUMNS[col]) {
          // Replace the encrypted blob with the boolean `*Set` flag and drop the original column.
          out[HTTP_MASKED_COLUMNS[col]] = Boolean(row[col]);
          delete out[col];
        } else if (row[col]) {
          // Graceful decrypt: on key mismatch (post-deploy regeneration) we log a marker
          // and return an empty value rather than crashing every read of `/api/settings`.
          // The admin then sees the field as empty in Paramètres → re-enters it → it gets
          // re-encrypted with the current key, restoring decryption on the next read.
          const r = safeDecrypt(row[col]);
          if (r.ok) {
            out[col] = r.value;
          } else {
            warnDecryptFailure(col, r.reason);
            out[col] = '';
          }
        }
      }
      return out;
    },

    upsert(payload = {}) {
      // The "*Set" mask fields are read-only outputs; ignore them on write.
      const keys = COLUMNS.filter((c) => Object.prototype.hasOwnProperty.call(payload, c));
      if (keys.length === 0) return;
      const setClauses = keys.map((c) => `${c} = ?`).join(', ');
      const values = keys.map((c) => {
        const v = payload[c];
        if (Object.prototype.hasOwnProperty.call(NUMERIC_DEFAULTS, c)) {
          if (v === '' || v == null) return NUMERIC_DEFAULTS[c];
          const n = Number(v);
          return Number.isFinite(n) ? n : NUMERIC_DEFAULTS[c];
        }
        if (v == null) return '';
        const str = typeof v === 'string' ? v : String(v);
        return ENCRYPTED_COLUMNS.includes(c) ? encrypt(str) : str;
      });
      databaseInstance
        .prepare(`UPDATE app_settings SET ${setClauses}, updatedAt = datetime('now') WHERE id = 1`)
        .run(...values);
    },

    updateLogoPath(path) {
      updateLogoStmt.run(String(path || ''));
    },

    // ----- SMTP / account-management helpers -----

    smtpConfigured() {
      const row = readRaw();
      const host = String(row.smtpHost || '').trim();
      return Boolean(host) && Boolean(resolveEmailIdentity(row).fromEmail);
    },

    publicUrl() {
      return String(readRaw().publicUrl || '').trim();
    },

    // Booking-notification config (specs/site-booking-notifications.md). Sender and recipient are
    // the resolved identity (specs/settings-rationalization.md rule 12): the recipient falls back to
    // the sending address, which falls back to the contact email.
    // `enabled` defaults ON (NaN/undefined on a partially-migrated DB → still ON, the safe default).
    notificationSettings() {
      const row = readRaw();
      const identity = resolveEmailIdentity(row);
      return {
        enabled: Number(row.notificationsEnabled) !== 0,
        // Per-channel switch for the iCal/platform new-reservation email; default ON (only an explicit 0 disables).
        icalReservationEnabled: Number(row.notifyIcalReservationEnabled) !== 0,
        recipientEmail: identity.recipient,
        fromEmail: identity.fromEmail,
        publicUrl: String(row.publicUrl || '').trim(),
      };
    },

    // The public website's origin, without its trailing slash, over PUBLIC_SITE_ORIGIN
    // (specs/plugins-phase-3a-online-payment.md rule 15). '' when neither is set.
    publicSiteOrigin() {
      const stored = String(readRaw().publicSiteOrigin || '').trim();
      return (stored || String(process.env.PUBLIC_SITE_ORIGIN || '').trim()).replace(/\/+$/, '');
    },

    storePublicSiteOrigin(value) {
      this.upsert({ publicSiteOrigin: String(value == null ? '' : value).trim().replace(/\/+$/, '') });
    },

    // Returns the SMTP block in the shape expected by `utils/emailService.createEmailService`.
    // The password is decrypted on the fly — caller must not log it. On key mismatch (deploy
    // regenerated `.env.local`, see PR #96) the password decodes to `''` and a marker fires
    // in PM2 logs; downstream `getEmailService()` then surfaces `EMAIL_NOT_CONFIGURED` cleanly
    // instead of crashing the request with `Error: Unsupported state or unable to authenticate data`.
    decryptedSmtpSettings() {
      const row = readRaw();
      const passEnc = row.smtpPasswordEncrypted || '';
      let password = '';
      let passwordDecryptFailed = false;
      if (passEnc) {
        const r = safeDecrypt(passEnc);
        if (r.ok) {
          password = r.value;
        } else {
          warnDecryptFailure('smtpPasswordEncrypted', r.reason);
          passwordDecryptFailed = true;
        }
      }
      const identity = resolveEmailIdentity(row);
      return {
        host: String(row.smtpHost || '').trim(),
        // Derived, never stored (specs/settings-rationalization.md rule 11).
        port: smtpPortForSecure(row.smtpSecure),
        secure: Number(row.smtpSecure) === 1,
        user: identity.username,
        password,
        // True when an encrypted blob exists in DB but can't be decrypted with the current
        // GUESTFLOW_ENCRYPTION_KEY. Consumed by `utils/emailService` to mark the service
        // as not configured (rather than crashing or silently sending without auth), and by
        // the client to display an actionable "re-enter the SMTP password" hint.
        passwordDecryptFailed,
        fromEmail: identity.fromEmail,
        fromName: identity.fromName,
      };
    },

    /**
     * One-time, idempotent migration: encrypt any credential still stored in clear text.
     * Safe to run on every boot — already-encrypted values are skipped.
     */
    migrateEncryption() {
      if (presentEncryptedCols.length === 0) return;
      const raw = databaseInstance
        .prepare(`SELECT ${presentEncryptedCols.join(', ')} FROM app_settings WHERE id = 1`)
        .get();
      if (!raw) return;
      for (const col of presentEncryptedCols) {
        const value = raw[col];
        if (value && !isEncrypted(value)) {
          databaseInstance
            .prepare(`UPDATE app_settings SET ${col} = ? WHERE id = 1`)
            .run(encrypt(value));
        }
      }
    },
  };
}

const defaultModel = createSettingsModel(db);
defaultModel.create = createSettingsModel;
defaultModel.COLUMNS = COLUMNS;

module.exports = defaultModel;
