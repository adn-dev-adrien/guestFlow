/**
 * Platform accounts model — aggregator behind GET/PUT `/api/accounting/platform-accounts`.
 *
 * Single source of truth for the per-platform commission config on the dedicated page
 * `/comptabilite/plateformes`. Reads + writes:
 *   - the export's four account and VAT settings (./settings, in plugin_settings since
 *     specs/plugins-phase-2-hosts.md rule 19): the fallback commission account, the commission
 *     VAT rate, the cancellation-compensation produit account and its VAT rate
 *   - `platforms.commissionAccountNumber` / `hasVatOnCommission` per platform (one row per unique
 *     iCal platform + the always-present `'direct'` row whose fields are server-side ignored,
 *     spec rule 18). The columns are core-declared; only this plugin reads and writes them (rule 20).
 *
 * Spec: accounting-platform-commission-and-no-deposit.md §3.7 + §4.3.
 *
 * Factory `create(db, { platforms, settings })`; the plugin builds it on `ctx.db`.
 */

const sdk = require('../sdk');
const { createAccountSettings, validateAccount, validateJournalCode } = require('./settings');
const { PLAN_DEFAULTS } = require('./accountPlan');

// specs/plugins-phase-p-productisation.md rules 27–28 — the account plan, edited on the same page.
const PLAN_KEYS = Object.keys(PLAN_DEFAULTS);

const { validateVatRate } = sdk.coreModule('settingsValidation');

// The two accounting VAT rates live on this page since specs/settings-rationalization.md rule 14,
// next to the accounts that use them. Absent key ⇒ untouched; present ⇒ a number from 0 to 100.
const VAT_RATE_FIELDS = ['vatRateCommission', 'vatRateCancellationCompensation'];

function validateRequiredVatRate(value) {
  if (value == null || String(value).trim() === '') return 'Taux requis (0 à 100 %).';
  return validateVatRate(String(value).replace(',', '.'));
}

// Validates a French chart-of-accounts code: 3 to 12 digits (specs/plugins-phase-p-productisation.md
// rule 28), so a 6-digit bucket (`622600`) and an 8-digit sub-account (`62260300`) both pass.
// Empty string = "use the default" on per-platform rows (legitimate).
function validateAccountNumber(value, { required = false } = {}) {
  if (value == null || value === '') {
    return required ? 'Compte requis (3 à 12 chiffres).' : null;
  }
  return validateAccount(value);
}

function createPlatformAccountsModel(database, { platforms = sdk.coreModule('platformsModel'), settings = createAccountSettings(database) } = {}) {
  return {
    getAll() {
      const {
        defaultCommissionAccountNumber: defaultAccount,
        vatRateCommission,
        cancellationCompensationAccount,
        vatRateCancellationCompensation,
      } = settings.read();
      const platformRows = (platforms.listAll ? platforms.listAll() : []) || [];
      const decoratedPlatforms = platformRows.map((p) => ({
        id: p.id,
        name: p.name,
        commissionAccountNumber: p.commissionAccountNumber || null,
        hasVatOnCommission: Number(p.hasVatOnCommission) === 1,
        isDirect: String(p.name).toLowerCase() === 'direct',
      }));
      const stored = settings.read();
      return {
        defaultAccount,
        vatRateCommission,
        cancellationCompensationAccount,
        vatRateCancellationCompensation,
        // Each role with its number and the default it falls back to (the page's helper text).
        plan: PLAN_KEYS.map((key) => ({ key, value: String(stored[key]), default: String(PLAN_DEFAULTS[key]) })),
        platforms: decoratedPlatforms,
      };
    },

    saveAll(payload) {
      const body = payload || {};
      const errors = {};
      const defaultErr = validateAccountNumber(body.defaultAccount, { required: true });
      if (defaultErr) errors.defaultAccount = defaultErr;
      // Absent key ⇒ untouched (a caller that doesn't know about the field must not blank it);
      // present key ⇒ must be a real account number.
      const editsCompensationAccount = Object.prototype.hasOwnProperty.call(body, 'cancellationCompensationAccount');
      if (editsCompensationAccount) {
        const compensationErr = validateAccountNumber(body.cancellationCompensationAccount, { required: true });
        if (compensationErr) errors.cancellationCompensationAccount = compensationErr;
      }
      const vatRates = {};
      for (const input of VAT_RATE_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(body, input)) continue;
        const err = validateRequiredVatRate(body[input]);
        if (err) errors[input] = err;
        else vatRates[input] = Number(String(body[input]).replace(',', '.'));
      }
      // Absent `plan` ⇒ untouched; an empty value goes back to the default.
      const plan = {};
      if (body.plan && typeof body.plan === 'object') {
        const planErrors = {};
        for (const key of PLAN_KEYS) {
          if (!Object.prototype.hasOwnProperty.call(body.plan, key)) continue;
          const value = String(body.plan[key] == null ? '' : body.plan[key]).trim();
          const err = key === 'journalCode' ? validateJournalCode(value) : validateAccount(value);
          if (err) planErrors[key] = err;
          else plan[key] = value || String(PLAN_DEFAULTS[key]);
        }
        if (Object.keys(planErrors).length) errors.plan = planErrors;
      }
      const platformList = Array.isArray(body.platforms) ? body.platforms : [];
      const perPlatformErrors = [];
      for (const p of platformList) {
        const accErr = validateAccountNumber(p.account, { required: false });
        if (accErr) {
          perPlatformErrors.push({ id: p.id, account: accErr });
        }
      }
      if (perPlatformErrors.length > 0) errors.platforms = perPlatformErrors;
      if (Object.keys(errors).length > 0) {
        return { error: errors, status: 400 };
      }
      const tx = database.transaction(() => {
        // 1) The export's own settings.
        settings.write({
          defaultCommissionAccountNumber: String(body.defaultAccount).trim(),
          ...(editsCompensationAccount
            ? { cancellationCompensationAccount: String(body.cancellationCompensationAccount).trim() }
            : {}),
          ...vatRates,
          ...plan,
        });
        // 2) Per-platform rows. Direct row writes are silently ignored by platformsModel.update.
        for (const p of platformList) {
          platforms.update({
            id: p.id,
            commissionAccountNumber: (p.account == null || p.account === '') ? null : String(p.account).trim(),
            hasVatOnCommission: p.hasVat === true || Number(p.hasVat) === 1 ? 1 : 0,
          });
        }
      });
      tx();
      return { ok: true, data: this.getAll() };
    },

    // Operator-triggered rescan of every platform string declared in the DB (iCal sources +
    // reservations.platform). Returns the updated GET payload + how many new rows were added.
    // Spec accounting-platform-commission-and-no-deposit.md §3.1 rule 2.
    refresh() {
      const newCount = platforms.rescan ? platforms.rescan() : 0;
      return { newCount, data: this.getAll() };
    },
  };
}

module.exports = {
  create: createPlatformAccountsModel,
  __test: { validateAccountNumber },
};
