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
 *   smtpConfigured()            → true when smtpHost AND smtpFromEmail are filled
 *   publicUrl()                 → the configured public URL (string, never null)
 *   decryptedSmtpSettings()     → { host, port, secure, user, password, fromEmail, fromName }
 *                                  with the password decrypted on the fly — used by the email
 *                                  service. Never exposed via HTTP.
 */

const db = require('../database');
const { encrypt, decrypt, isEncrypted, safeDecrypt } = require('../utils/encryption');

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

// Columns encrypted at rest (AES-256-GCM). Google + SMTP credentials.
const ENCRYPTED_COLUMNS = [
  'googleCalendarId',
  'googleServiceAccountEmail',
  'googleServiceAccountPrivateKey',
  'smtpPasswordEncrypted',
];

const COLUMNS = [
  'googleCalendarId',
  'googleServiceAccountEmail',
  'googleServiceAccountPrivateKey',
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
  'quoteValidityDays',
  'companyLogoPath',
  'vatRateAccommodation',
  'vatRateStandard',
  // SMTP for the account-management flow (specs/admin-account-management.md). The password column
  // stores the AES-256-GCM ciphertext; the model masks it on read and exposes a boolean flag
  // (smtpPasswordSet) so the client never sees the cleartext or the ciphertext blob.
  'smtpHost',
  'smtpPort',
  'smtpSecure',
  'smtpUsername',
  'smtpPasswordEncrypted',
  'smtpFromEmail',
  'smtpFromName',
  'publicUrl',
  // Admin-only escape hatch for past reservations (see specs/admin-unlock-past-reservations.md).
  // Stored as INTEGER (0/1) to mirror smtpSecure; the model's `allowEditPastReservations()`
  // helper casts to boolean for the controller, but read() returns the raw integer for the
  // API payload — consistent with smtpSecure (no surprise cast at the boundary).
  'allowEditPastReservations',
  // Weekly bed-linen tracking (specs/weekly-bed-linen-tracking.md). 0=Sun .. 6=Sat, default
  // 2 (Tuesday). Drives the LaundryDayCard on PlanningPage. Range-validated in the controller
  // (400 INVALID_WEEKDAY).
  'laundryWeekday',
];

const NUMERIC_DEFAULTS = {
  quoteValidityDays: 30,
  vatRateAccommodation: 10,
  vatRateStandard: 20,
  smtpPort: 587,
  smtpSecure: 0,
  allowEditPastReservations: 0,
  laundryWeekday: 2,
};

const STRING_DEFAULT_OVERRIDES = {
  smtpFromName: 'GuestFlow',
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
  const readStmt = databaseInstance.prepare(
    `SELECT ${COLUMNS.join(', ')}, createdAt, updatedAt FROM app_settings WHERE id = 1`
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
      const fromEmail = String(row.smtpFromEmail || '').trim();
      return Boolean(host) && Boolean(fromEmail);
    },

    publicUrl() {
      return String(readRaw().publicUrl || '').trim();
    },

    // Admin escape hatch — when true, both reservation-controller locks (PUT field allowlist
    // + DELETE 403) are dropped for past reservations. Default-driven by the column's NOT NULL
    // DEFAULT 0 (see database.js migration). See specs/admin-unlock-past-reservations.md.
    allowEditPastReservations() {
      return Number(readRaw().allowEditPastReservations) === 1;
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
      return {
        host: String(row.smtpHost || '').trim(),
        port: Number(row.smtpPort) || 587,
        secure: Number(row.smtpSecure) === 1,
        user: String(row.smtpUsername || '').trim(),
        password,
        // True when an encrypted blob exists in DB but can't be decrypted with the current
        // GUESTFLOW_ENCRYPTION_KEY. Consumed by `utils/emailService` to mark the service
        // as not configured (rather than crashing or silently sending without auth), and by
        // the client to display an actionable "re-enter the SMTP password" hint.
        passwordDecryptFailed,
        fromEmail: String(row.smtpFromEmail || '').trim(),
        fromName: String(row.smtpFromName || '').trim() || 'GuestFlow',
      };
    },

    /**
     * One-time, idempotent migration: encrypt any Google credential still stored in clear text.
     * Safe to run on every boot — already-encrypted values are skipped.
     */
    migrateEncryption() {
      const raw = databaseInstance
        .prepare(`SELECT ${ENCRYPTED_COLUMNS.join(', ')} FROM app_settings WHERE id = 1`)
        .get();
      if (!raw) return;
      for (const col of ENCRYPTED_COLUMNS) {
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
