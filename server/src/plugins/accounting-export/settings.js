/**
 * The four account and VAT settings of the export, stored in plugin_settings
 * (specs/plugins-phase-2-hosts.md rule 19, P7). Bound to a GIVEN database so the journal and the
 * Plan comptable page read the same store in production and on an in-memory test database. A store
 * that is missing or empty reads the shipped defaults — the values erasure goes back to (rule 22).
 */

const { DEFAULT_COMMISSION_ACCOUNT, DEFAULT_CANCELLATION_COMPENSATION_ACCOUNT, PLAN_DEFAULTS } = require('./accountPlan');

const PLUGIN_ID = 'accounting-export';

const DEFAULTS = Object.freeze({
  defaultCommissionAccountNumber: DEFAULT_COMMISSION_ACCOUNT,
  vatRateCommission: 20,
  cancellationCompensationAccount: DEFAULT_CANCELLATION_COMPENSATION_ACCOUNT,
  vatRateCancellationCompensation: 0,
  // The account plan (specs/plugins-phase-p-productisation.md rule 27).
  ...PLAN_DEFAULTS,
});

const KEYS = Object.freeze(Object.keys(DEFAULTS));
const RATE_KEYS = new Set(['vatRateCommission', 'vatRateCancellationCompensation']);

// The same checks as the Plan comptable page, so the generic PUT cannot store what the page refuses.
function validateRate(value) {
  if (value == null || String(value).trim() === '') return null;
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 && n <= 100 ? null : 'Doit être un nombre entre 0 et 100.';
}

// Rule 28: 3 to 12 digits for an account, 1 to 4 capitals or digits for the journal code.
function validateAccount(value) {
  if (value == null || String(value).trim() === '') return null;
  return /^\d{3,12}$/.test(String(value).trim()) ? null : 'De 3 à 12 chiffres.';
}

function validateJournalCode(value) {
  if (value == null || String(value).trim() === '') return null;
  return /^[A-Z0-9]{1,4}$/.test(String(value).trim()) ? null : 'De 1 à 4 majuscules ou chiffres.';
}

const validatorOf = (key) => {
  if (RATE_KEYS.has(key)) return validateRate;
  return key === 'journalCode' ? validateJournalCode : validateAccount;
};

// What `ctx.settings.declare` receives: the generic GET/PUT /api/plugins/accounting-export/settings.
const DECLARED = KEYS.map((key) => ({ key, default: String(DEFAULTS[key]), validate: validatorOf(key) }));

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

// specs/accountant-accounting-export.md rule 35 — the first payment day the TTC-share split (rule 32)
// applies to. Not an operator setting: written once by the migration, on the first start of the version
// that brought the split. Without it (an erased store), the first month no release before could have
// exported.
const TTC_SPLIT_KEY = 'ttcSplitFrom';
const TTC_SPLIT_FALLBACK = '2026-11-01';

// The first day of the month after `date`, as YYYY-MM-DD in local time.
function firstOfNextMonth(date = new Date()) {
  const next = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`;
}

function readTtcSplitFrom(database) {
  try {
    const row = database.prepare('SELECT value FROM plugin_settings WHERE plugin_id = ? AND key = ?').get(PLUGIN_ID, TTC_SPLIT_KEY);
    return row && /^\d{4}-\d{2}-\d{2}$/.test(String(row.value)) ? String(row.value) : TTC_SPLIT_FALLBACK;
  } catch {
    return TTC_SPLIT_FALLBACK;
  }
}

// The migration: stores the first day of next month, once.
function storeTtcSplitFrom(database, now = new Date()) {
  database.prepare('INSERT OR IGNORE INTO plugin_settings (plugin_id, key, value) VALUES (?, ?, ?)')
    .run(PLUGIN_ID, TTC_SPLIT_KEY, firstOfNextMonth(now));
}

module.exports = {
  PLUGIN_ID, DEFAULTS, KEYS, DECLARED, createAccountSettings, validateAccount, validateJournalCode,
  TTC_SPLIT_KEY, TTC_SPLIT_FALLBACK, firstOfNextMonth, readTtcSplitFrom, storeTtcSplitFrom,
};
