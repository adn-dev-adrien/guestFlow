/**
 * Default admin bootstrap credentials, documented in the README.
 *
 * Seeded on first launch (when the `users` table is empty) with `mustChangePassword = 1`, so the
 * default password only unlocks the "set your password" screen. The operator MUST change it
 * immediately on first launch.
 */
module.exports = {
  DEFAULT_ADMIN_EMAIL: 'admin@guestflow.local',
  DEFAULT_ADMIN_PASSWORD: 'ChangeMe!2026',
  MIN_PASSWORD_LENGTH: 10,
};
