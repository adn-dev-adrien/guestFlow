/**
 * Onboarding model — `app_settings.onboardingCompletedAt` (specs/plugins-phase-p-productisation.md
 * §3.D rules 20–22). Empty means the start assistant is still open.
 *
 * API: buildModel(db) → { isOpen(), complete() }
 */

function buildModel(database) {
  function isOpen() {
    try {
      const row = database.prepare('SELECT onboardingCompletedAt AS at FROM app_settings LIMIT 1').get();
      return !row || !row.at;
    } catch {
      return false;
    }
  }

  function complete() {
    database.prepare(`
      INSERT INTO app_settings (id, onboardingCompletedAt) VALUES (1, datetime('now'))
      ON CONFLICT (id) DO UPDATE SET onboardingCompletedAt = COALESCE(onboardingCompletedAt, excluded.onboardingCompletedAt)
    `).run();
  }

  return { isOpen, complete };
}

module.exports = { buildModel };
