/**
 * The four account and VAT settings of the export, stored in plugin_settings
 * (specs/plugins-phase-2-hosts.md rule 19, P7). Bound to a GIVEN database so the journal and the
 * Plan comptable page read the same store in production and on an in-memory test database. A store
 * that is missing or empty reads the shipped defaults — the values erasure goes back to (rule 22).
 */

const { DEFAULT_COMMISSION_ACCOUNT, DEFAULT_CANCELLATION_COMPENSATION_ACCOUNT } = require('./accountPlan');

const PLUGIN_ID = 'accounting-export';

const DEFAULTS = Object.freeze({
  defaultCommissionAccountNumber: DEFAULT_COMMISSION_ACCOUNT,
  vatRateCommission: 20,
  cancellationCompensationAccount: DEFAULT_CANCELLATION_COMPENSATION_ACCOUNT,
  vatRateCancellationCompensation: 0,
});

const KEYS = Object.freeze(Object.keys(DEFAULTS));
const RATE_KEYS = new Set(['vatRateCommission', 'vatRateCancellationCompensation']);

// What `ctx.settings.declare` receives: the generic GET/PUT /api/plugins/accounting-export/settings.
const DECLARED = KEYS.map((key) => ({ key, default: String(DEFAULTS[key]) }));

function parseValue(key, raw) {
  if (raw == null || String(raw).trim() === '') return DEFAULTS[key];
  if (!RATE_KEYS.has(key)) return String(raw).trim();
  const n = Number(String(raw).replace(',', '.'));
  return Number.isFinite(n) ? n : DEFAULTS[key];
}

function createAccountSettings(database) {
  const storedRows = () => {
    try {
      return database.prepare('SELECT key, value FROM plugin_settings WHERE plugin_id = ?').all(PLUGIN_ID);
    } catch {
      return [];
    }
  };

  return {
    // { defaultCommissionAccountNumber, vatRateCommission, cancellationCompensationAccount,
    //   vatRateCancellationCompensation } — accounts as strings, rates as numbers.
    read() {
      const stored = new Map(storedRows().map((r) => [r.key, r.value]));
      return Object.fromEntries(KEYS.map((key) => [key, parseValue(key, stored.get(key))]));
    },

    // Writes the keys present in `patch`; the caller validated them.
    write(patch = {}) {
      const upsert = database.prepare(`
        INSERT INTO plugin_settings (plugin_id, key, value, updated_at) VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(plugin_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `);
      KEYS.filter((key) => Object.prototype.hasOwnProperty.call(patch, key))
        .forEach((key) => upsert.run(PLUGIN_ID, key, String(patch[key])));
    },

    // Settings whose stored value differs from the default — what an erasure would change.
    customisedCount() {
      const current = this.read();
      return KEYS.filter((key) => (RATE_KEYS.has(key)
        ? Number(current[key]) !== Number(DEFAULTS[key])
        : String(current[key]) !== String(DEFAULTS[key]))).length;
    },
  };
}

module.exports = { PLUGIN_ID, DEFAULTS, KEYS, DECLARED, createAccountSettings };
