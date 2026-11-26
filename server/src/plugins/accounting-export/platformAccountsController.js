/**
 * Platform accounts controller — thin GET/PUT pair for `/api/accounting/platform-accounts`.
 *
 * Accessible to both admin AND accountant (the plugin's accountant entries — see index.js — open
 * this route pair); the VAT rate on commissions is written by the admin only.
 * Mirrors the shape of the accounting controller for consistency.
 *
 * Spec: accounting-platform-commission-and-no-deposit.md §3.7 + §4.3.
 */

const sdk = require('../sdk');

const { ADMIN, userHasRole } = sdk.coreModule('roles');

// `regimeInForce()` → { regime } — what the page needs to hide the VAT rates that cannot apply
// (specs/accounting/vat-optional-mode.md rule 12g): the sales VAT regime in force today.
function createController(platformAccountsModel, { regimeInForce = () => ({ regime: 'subject' }) } = {}) {
  return {
    getAll(req, res) {
      return res.json({ ...platformAccountsModel.getAll(), salesVatRegime: regimeInForce().regime });
    },
    saveAll(req, res) {
      // specs/settings/settings-rationalization.md rule 14 — the accountant edits the account numbers; the VAT rate
      // on commissions is the admin's, so a PUT that changes it is refused before anything is written.
      const body = req.body || {};
      if (!userHasRole(req.user, ADMIN) && Object.prototype.hasOwnProperty.call(body, 'vatRateCommission')) {
        const sent = Number(String(body.vatRateCommission).replace(',', '.'));
        if (!(sent === Number(platformAccountsModel.getAll().vatRateCommission))) {
          return res.status(403).json({ code: 'VAT_RATE_ADMIN_ONLY', error: 'Le taux de TVA des commissions est réservé à l\'administrateur.' });
        }
      }
      const result = platformAccountsModel.saveAll(body);
      if (result.error) {
        return res.status(result.status || 400).json({ code: 'PLATFORM_ACCOUNTS_INVALID', errors: result.error });
      }
      return res.json(result.data);
    },
    refresh(req, res) {
      const { newCount, data } = platformAccountsModel.refresh();
      return res.json({ ...data, newCount, salesVatRegime: regimeInForce().regime });
    },
  };
}

module.exports = { create: createController };
