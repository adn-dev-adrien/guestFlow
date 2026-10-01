/**
 * Platform accounts controller — thin GET/PUT pair for `/api/accounting/platform-accounts`.
 *
 * Accessible to both admin AND accountant (the plugin's accountant entries — see index.js — open
 * this route pair). Mirrors the shape of the accounting controller for consistency.
 *
 * Spec: accounting-platform-commission-and-no-deposit.md §3.7 + §4.3.
 */

function createController(platformAccountsModel) {
  return {
    getAll(req, res) {
      return res.json(platformAccountsModel.getAll());
    },
    saveAll(req, res) {
      const result = platformAccountsModel.saveAll(req.body || {});
      if (result.error) {
        return res.status(result.status || 400).json({ code: 'PLATFORM_ACCOUNTS_INVALID', errors: result.error });
      }
      return res.json(result.data);
    },
    refresh(req, res) {
      const { newCount, data } = platformAccountsModel.refresh();
      return res.json({ ...data, newCount });
    },
  };
}

module.exports = { create: createController };
