/**
 * Is this process the release a self-update has swapped in and its helper has not verified yet (specs/hosting/self-update-and-releases.md rules 30b, 31, 57)?
 *
 * `awaitingVerification({ status, version, now })` → true while `data/update-status.json` says the helper may still judge this very version:
 *   - the swap is in flight towards it (`swapping` / `restarting`) — with an error recorded too: that is the helper rolling it back;
 *   - or the status reads `done` but only because this process's own boot wrote it (`concludedBy: 'boot'`, rule 30b) and the helper's
 *     verification window (`HELPER_WINDOW_MS`, its health-check timeout and the rollback restart) has not passed since. The helper's own `done`
 *     rewrites the whole file without that marker, so its verdict ends the wait at once; a helper that died leaves the marker and the wait ends
 *     with the window.
 * A failed verification hands the database back to the previous release, so a step that release cannot run on (pricing-components rule 85, T10)
 * waits. Anything else — no update (a fresh install), a terminal phase written by the helper, another target, a development tree — answers false.
 * Pure but for `statusOf`, which reads the status file.
 */
const IN_FLIGHT = new Set(['swapping', 'restarting']);
// The helper waits up to 120 s for the version (`utils/updateHelper.js` DEFAULT_TIMEOUT_SECONDS), then repoints and restarts the previous release;
// ten minutes covers both with room for a slow restart.
const HELPER_WINDOW_MS = 10 * 60 * 1000;

function awaitingVerification({ status, version, now = Date.now() }) {
  if (!status || !version || status.targetVersion !== version) return false;
  if (IN_FLIGHT.has(status.phase)) return true;
  if (status.phase !== 'done' || status.concludedBy !== 'boot' || status.errorCode) return false;
  const concludedAt = Date.parse(status.updatedAt);
  return Number.isNaN(concludedAt) || now - concludedAt < HELPER_WINDOW_MS;
}

function statusOf() {
  try { return require('../models/updateStateModel').readStatus(); } catch { return null; }
}

function thisReleaseAwaitsVerification(now = Date.now()) {
  return awaitingVerification({ status: statusOf(), version: require('./appVersion').getAppVersion(), now });
}

module.exports = { awaitingVerification, thisReleaseAwaitsVerification, HELPER_WINDOW_MS };
