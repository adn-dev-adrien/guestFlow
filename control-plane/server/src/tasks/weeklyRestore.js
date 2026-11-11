/**
 * Every Sunday (specs/hosting-h1-fleet-runtime.md rule 13), run from the console's daily pass: each
 * customer's latest backup is restored into a temporary folder and checked (utils/restoreVerifier.js).
 * The day of the last run is kept in `meta`, so a console down on Sunday runs it when it comes back
 * the same day, and never twice.
 */

function isSunday(day) {
  return new Date(`${day}T12:00:00Z`).getUTCDay() === 0;
}

function createWeeklyRestore({ meta, verifier, today, log = (msg) => console.log(msg) }) {
  async function runIfDue() {
    const day = today();
    if (!isSunday(day) || meta.get('lastWeeklyRestore') === day) return null;
    meta.set('lastWeeklyRestore', day);
    const results = await verifier.weekly();
    const failed = results.filter((r) => !r.ok).length;
    log(`[restore-check] ${day}: ${results.length} restored, ${failed} failed`);
    return results;
  }
  return { runIfDue, isSunday };
}

module.exports = { createWeeklyRestore, isSunday };
