/**
 * Boot cleanup of push subscriptions (specs/pwa-push-notifications.md rule 13): deletes the devices of
 * an owner who is not an active, non-support administrator, so a row left by an older version cannot
 * come back to life when the account is reactivated. Idempotent. Returns the number of rows deleted.
 */

function pruneIneligiblePushSubscriptions(db) {
  const has = (name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
  if (!has('push_subscriptions') || !has('users') || !has('user_roles')) return 0;
  return db.prepare(`
    DELETE FROM push_subscriptions
    WHERE userId NOT IN (
      SELECT u.id FROM users u
      JOIN user_roles r ON r.userId = u.id AND r.role = 'admin'
      WHERE u.isActive = 1 AND u.isSupportAccount = 0
    )
  `).run().changes;
}

module.exports = { pruneIneligiblePushSubscriptions };
