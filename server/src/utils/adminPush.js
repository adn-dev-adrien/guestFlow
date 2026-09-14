/**
 * A push notification for every active administrator (specs/gate-access-portier.md §3.2, §3.6).
 *
 * The gate notifications are for the people who administer the accesses — not for reception or the
 * accountant, whatever their own push preferences say — so they go device by device to the admins
 * rather than through a preference key. Never throws: a notification must not break its caller.
 */

async function pushToAdmins(payload, {
  usersModel = require('../models/usersModel'),
  pushService = require('./pushService'),
  logger = console,
} = {}) {
  try {
    const ids = usersModel.listActiveAdminIds();
    let sent = 0;
    for (const id of ids) {
      const result = await pushService.sendToUser(id, payload);
      sent += Number((result && result.sent) || 0);
    }
    return { admins: ids.length, sent };
  } catch (err) {
    logger.warn('[adminPush]', err && err.message ? err.message : err);
    return { admins: 0, sent: 0, error: true };
  }
}

module.exports = { pushToAdmins };
