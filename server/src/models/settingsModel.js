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
const { encrypt, decrypt, isEncrypted } = require('../utils/encryption');

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
];

const NUMERIC_DEFAULTS = {
  quoteValidityDays: 30,
  vatRateAccommodation: 10,
  vatRateStandard: 20,
  smtpPort: 587,
  smtpSecure: 0,
  allowEditPastReservations: 0,
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
          out[col] = decrypt(row[col]);
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
    // The password is decrypted on the fly — caller must not log it.
    decryptedSmtpSettings() {
      const row = readRaw();
      const passEnc = row.smtpPasswordEncrypted || '';
      return {
        host: String(row.smtpHost || '').trim(),
        port: Number(row.smtpPort) || 587,
        secure: Number(row.smtpSecure) === 1,
        user: String(row.smtpUsername || '').trim(),
        password: passEnc ? decrypt(passEnc) : '',
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
