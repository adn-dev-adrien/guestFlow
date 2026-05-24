/**
 * Settings model — sole DB access layer for the `app_settings` singleton row.
 *
 * Exports a default model bound to the production database, and a `create(db)`
 * factory so tests can instantiate a model against an in-memory database.
 *
 * API:
 *   read()                 → full row (defaults to empty strings / 30 / '' if no row)
 *   upsert(payload)        → writes only the keys present in payload (per-field 3-way)
 *   updateLogoPath(path)   → single-column update of companyLogoPath
 */

const db = require('../database');

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
];

const DEFAULTS = COLUMNS.reduce((acc, col) => {
  acc[col] = col === 'quoteValidityDays' ? 30 : '';
  return acc;
}, { createdAt: null, updatedAt: null });

function createSettingsModel(databaseInstance) {
  const readStmt = databaseInstance.prepare(
    `SELECT ${COLUMNS.join(', ')}, createdAt, updatedAt FROM app_settings WHERE id = 1`
  );

  const updateLogoStmt = databaseInstance.prepare(
    `UPDATE app_settings SET companyLogoPath = ?, updatedAt = datetime('now') WHERE id = 1`
  );

  return {
    read() {
      const row = readStmt.get();
      if (!row) return { ...DEFAULTS };
      return row;
    },

    upsert(payload = {}) {
      // Build dynamic UPDATE for only the fields present in payload.
      const keys = COLUMNS.filter((c) => Object.prototype.hasOwnProperty.call(payload, c));
      if (keys.length === 0) return;
      const setClauses = keys.map((c) => `${c} = ?`).join(', ');
      const values = keys.map((c) => {
        const v = payload[c];
        if (c === 'quoteValidityDays') return Number(v) || 30;
        if (v == null) return '';
        return typeof v === 'string' ? v : String(v);
      });
      databaseInstance
        .prepare(`UPDATE app_settings SET ${setClauses}, updatedAt = datetime('now') WHERE id = 1`)
        .run(...values);
    },

    updateLogoPath(path) {
      updateLogoStmt.run(String(path || ''));
    },
  };
}

const defaultModel = createSettingsModel(db);
defaultModel.create = createSettingsModel;
defaultModel.COLUMNS = COLUMNS;

module.exports = defaultModel;
