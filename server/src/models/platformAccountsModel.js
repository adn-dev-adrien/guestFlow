/**
 * Platform accounts model — aggregator behind GET/PUT `/api/accounting/platform-accounts`.
 *
 * Single source of truth for the per-platform commission config on the dedicated page
 * `/comptabilite/plateformes`. Reads + writes:
 *   - `app_settings.defaultCommissionAccountNumber` (global fallback account)
 *   - `platforms.*` per-platform rows (one per unique iCal platform + the always-present
 *     `'direct'` row whose fields are server-side ignored, spec rule 18)
 *
 * The VAT rate (`vatRateCommission`) lives in Settings → Général and is read-only on this
 * page (rule 17b). The model exposes it on GET as a convenience for the UI's read-only
 * caption but never lets PUT mutate it — the canonical edit surface is `PUT /api/settings`.
 *
 * Spec: accounting-platform-commission-and-no-deposit.md §3.7 + §4.3.
 *
 * Factory `create(db)` (+ default bound to prod DB), mirroring the other models.
 */

const db = require('../database');
const platformsModel = require('./platformsModel');
const settingsModel = require('./settingsModel');
const { DEFAULT_COMMISSION_ACCOUNT } = require('../constants/accounting');

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

function validateRatePercent(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return 'Taux doit être un nombre entre 0 et 100.';
  if (n < 0 || n > 100) return 'Taux doit être compris entre 0 et 100.';
  return null;
}

function createPlatformAccountsModel(database, { platforms = platformsModel, settings = settingsModel } = {}) {
  return {
    getAll() {
      const settingsRow = settings.read ? settings.read() : database.prepare('SELECT * FROM app_settings WHERE id = 1').get();
      const defaultAccount = (settingsRow && settingsRow.defaultCommissionAccountNumber) || DEFAULT_COMMISSION_ACCOUNT;
      const vatRateCommission = settingsRow && settingsRow.vatRateCommission != null
        ? Number(settingsRow.vatRateCommission)
        : 20;
      const platformRows = (platforms.listAll ? platforms.listAll() : []) || [];
      const decoratedPlatforms = platformRows.map((p) => ({
        id: p.id,
        name: p.name,
        commissionAccountNumber: p.commissionAccountNumber || null,
        hasVatOnCommission: Number(p.hasVatOnCommission) === 1,
        commissionRatePercent: p.commissionRatePercent == null ? null : Number(p.commissionRatePercent),
        isDirect: String(p.name).toLowerCase() === 'direct',
      }));
      return { defaultAccount, vatRateCommission, platforms: decoratedPlatforms };
    },

    saveAll(payload) {
      const body = payload || {};
      const errors = {};
      const defaultErr = validateAccountNumber(body.defaultAccount, { required: true });
      if (defaultErr) errors.defaultAccount = defaultErr;
      const platformList = Array.isArray(body.platforms) ? body.platforms : [];
      const perPlatformErrors = [];
      for (const p of platformList) {
        const accErr = validateAccountNumber(p.account, { required: false });
        const rateErr = validateRatePercent(p.ratePercent);
        if (accErr || rateErr) {
          perPlatformErrors.push({ id: p.id, account: accErr || null, ratePercent: rateErr || null });
        }
      }
      if (perPlatformErrors.length > 0) errors.platforms = perPlatformErrors;
      if (Object.keys(errors).length > 0) {
        return { error: errors, status: 400 };
      }
      const tx = database.transaction(() => {
        // 1) Default account → app_settings.
        settings.upsert({ defaultCommissionAccountNumber: String(body.defaultAccount).trim() });
        // 2) Per-platform rows. Direct row writes are silently ignored by platformsModel.update.
        for (const p of platformList) {
          platforms.update({
            id: p.id,
            commissionAccountNumber: (p.account == null || p.account === '') ? null : String(p.account).trim(),
            hasVatOnCommission: p.hasVat === true || Number(p.hasVat) === 1 ? 1 : 0,
            commissionRatePercent: (p.ratePercent == null || p.ratePercent === '') ? null : Number(p.ratePercent),
          });
        }
      });
      tx();
      return { ok: true, data: this.getAll() };
    },
  };
}

const defaultModel = createPlatformAccountsModel(db);
defaultModel.create = createPlatformAccountsModel;
defaultModel.__test = { validateAccountNumber, validateRatePercent };

module.exports = defaultModel;
