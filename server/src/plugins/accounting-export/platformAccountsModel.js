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
const { createAccountSettings } = require('./settings');

const { validateVatRate } = sdk.coreModule('settingsValidation');

// The two accounting VAT rates live on this page since specs/settings-rationalization.md rule 14,
// next to the accounts that use them. Absent key ⇒ untouched; present ⇒ a number from 0 to 100.
const VAT_RATE_FIELDS = ['vatRateCommission', 'vatRateCancellationCompensation'];

function validateRequiredVatRate(value) {
  if (value == null || String(value).trim() === '') return 'Taux requis (0 à 100 %).';
  return validateVatRate(String(value).replace(',', '.'));
}

// Validates a French chart-of-accounts code. We accept 6 to 8 digits:
//   - 6 digits = generic bucket account (`622600` is the default).
//   - 8 digits = specific sub-account (`62260300` Airbnb, `62260500` Gîtes de France, etc.).
// Empty string = "use the default" on per-platform rows (legitimate).
function validateAccountNumber(value, { required = false } = {}) {
  if (value == null || value === '') {
    return required ? 'Compte requis (6 à 8 chiffres).' : null;
  }
  const str = String(value).trim();
  if (!/^\d{6,8}$/.test(str)) return 'Compte doit comporter 6 à 8 chiffres.';
  return null;
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
      return {
        defaultAccount,
        vatRateCommission,
        cancellationCompensationAccount,
        vatRateCancellationCompensation,
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
