/**
 * Is this process the release a self-update has swapped in and its helper has not verified yet (specs/self-update-and-releases.md rules 31, 57)?
 *
 * `awaitingVerification({ status, version })` → true while `data/update-status.json` says the swap is in flight (`swapping` / `restarting`,
 * no error) towards this very version: a failed verification would hand the database back to the previous release, so a step that previous
 * release cannot run on (pricing-components rule 85, T10) waits until the helper writes `done`. Anything else — no update, a terminal phase,
 * another target, a development tree — answers false. Pure but for `statusOf`, which reads the status file.
 */
const IN_FLIGHT = new Set(['swapping', 'restarting']);

function awaitingVerification({ status, version }) {
  if (!status || !IN_FLIGHT.has(status.phase) || status.errorCode) return false;
  return Boolean(version) && status.targetVersion === version;
}

function statusOf() {
  try { return require('../models/updateStateModel').readStatus(); } catch { return null; }
}

function thisReleaseAwaitsVerification() {
  return awaitingVerification({ status: statusOf(), version: require('./appVersion').getAppVersion() });
}

module.exports = { awaitingVerification, thisReleaseAwaitsVerification };
