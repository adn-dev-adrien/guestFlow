/**
 * Platform accounts controller — thin GET/PUT pair for `/api/accounting/platform-accounts`.
 *
 * Accessible to both admin AND accountant (the role gate in `middleware/enforceRoleAccess`
 * whitelists this route pair). Mirrors the shape of accountingController for consistency.
 *
 * Spec: accounting-platform-commission-and-no-deposit.md §3.7 + §4.3.
 */

const model = require('../models/platformAccountsModel');

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

const defaultController = createController(model);
defaultController.create = createController;

module.exports = defaultController;
