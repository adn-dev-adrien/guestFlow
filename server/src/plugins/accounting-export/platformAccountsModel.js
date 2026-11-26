/**
 * Platform accounts model — aggregator behind GET/PUT `/api/accounting/platform-accounts`.
 *
 * Single source of truth for the per-platform commission config on the dedicated page
 * `/comptabilite/plateformes`. Reads + writes:
 *   - the export's four account and VAT settings (./settings, in plugin_settings since
 *     specs/plugins-phase-2-hosts.md rule 19): the fallback commission account, the commission
 *     VAT rate, the cancellation-compensation produit account and its VAT rate
 *   - `platforms.commissionAccountNumber` / `commissionVatRegime` per platform (`hasVatOnCommission` follows the regime and is still
 *     accepted on write for one release: `true` → `fr_vat`) (one row per unique
 *     iCal platform + the always-present `'direct'` row whose fields are server-side ignored,
 *     spec rule 18). The columns are core-declared; only this plugin reads and writes them (rule 20).
 *
 * Spec: accounting-platform-commission-and-no-deposit.md §3.7 + §4.3.
 *
 * Factory `create(db, { platforms, settings })`; the plugin builds it on `ctx.db`.
 */

const sdk = require('../sdk');
const {
  createAccountSettings, validateAccount, validateJournalCode, validateVatCode, VAT_CODE_KEYS,
} = require('./settings');
const {
  PLAN_DEFAULTS, COMMISSION_REGIMES, REGIME_ACCOUNT_ROLES, REGIME_LABELS,
} = require('./accountPlan');

// specs/plugins-phase-p-productisation.md rules 27–28 — the account plan, edited on the same page.
const PLAN_KEYS = Object.keys(PLAN_DEFAULTS);

const { validateVatRate } = sdk.coreModule('settingsValidation');

// The two accounting VAT rates live on this page since specs/settings-rationalization.md rule 14,
// next to the accounts that use them. Absent key ⇒ untouched; present ⇒ a number from 0 to 100.
const VAT_RATE_FIELDS = ['vatRateCommission', 'vatRateCancellationCompensation'];

function validateRequiredVatRate(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return 'Taux requis (0 à 100 %).';
  if (String(value).trim() === '') return 'Taux requis (0 à 100 %).';
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

function validatePlanValue(key, value) {
  if (key === 'journalCode') return validateJournalCode(value);
  if (VAT_CODE_KEYS.has(key)) return validateVatCode(value);
  if (key === 'reverseChargeLines') return ['', '0', '1'].includes(value) ? null : 'Doit être 0 ou 1.';
  return validateAccount(value);
}

// Rule 14 — the account a regime proposes, from the three plan roles.
const proposalOf = (regime, stored) => String(stored[REGIME_ACCOUNT_ROLES[regime]] || PLAN_DEFAULTS[REGIME_ACCOUNT_ROLES[regime]]);

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
        commissionVatRegime: p.commissionVatRegime,
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
        // Rules 13-14 — the regimes the page offers, their labels, and the account each proposes (the page shows it as the choice is made).
        regimes: COMMISSION_REGIMES.map((regime) => ({ key: regime, label: REGIME_LABELS[regime], account: proposalOf(regime, stored) })),
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
          const raw = body.plan[key];
          if (raw !== null && raw !== undefined && typeof raw !== 'string' && typeof raw !== 'number') {
            planErrors[key] = 'Valeur invalide.';
            continue;
          }
          const value = String(raw == null ? '' : raw).trim();
          const err = validatePlanValue(key, value);
          if (err) planErrors[key] = err;
          else plan[key] = value || String(PLAN_DEFAULTS[key]);
        }
        if (Object.keys(planErrors).length) errors.plan = planErrors;
      }
      const platformList = Array.isArray(body.platforms) ? body.platforms : [];
      const perPlatformErrors = [];
      for (const p of platformList) {
        if (!p || typeof p !== 'object' || Array.isArray(p)) {
          perPlatformErrors.push({ id: null, account: 'Valeur invalide.' });
          continue;
        }
        const accErr = validateAccountNumber(p.account, { required: false });
        if (accErr) {
          perPlatformErrors.push({ id: p.id, account: accErr });
        }
        if (p.regime != null && !COMMISSION_REGIMES.includes(p.regime)) perPlatformErrors.push({ id: p.id, regime: 'Régime de TVA inconnu.' });
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
        const stored = settings.read();
        const before = new Map(((platforms.listAll ? platforms.listAll() : []) || []).map((row) => [Number(row.id), row]));
        for (const p of platformList) {
          const current = before.get(Number(p.id));
          const typed = (p.account == null || p.account === '') ? null : String(p.account).trim();
          let account = typed;
          // Rule 14 — choosing a regime proposes its account when the platform has none or still holds the previous regime's proposal;
          // a typed account is never overwritten.
          if (current && COMMISSION_REGIMES.includes(p.regime) && p.regime !== current.commissionVatRegime
            && (typed == null || typed === proposalOf(current.commissionVatRegime, stored))) {
            account = proposalOf(p.regime, stored);
          }
          platforms.update({
            id: p.id,
            commissionAccountNumber: account,
            ...(p.regime != null ? { commissionVatRegime: p.regime } : { hasVatOnCommission: p.hasVat === true || Number(p.hasVat) === 1 ? 1 : 0 }),
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
