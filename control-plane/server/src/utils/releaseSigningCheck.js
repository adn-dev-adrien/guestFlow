/**
 * Release signing is the only barrier between a published release and the licence key: the console runs
 * each release's own scripts as its own unix user (specs/self-update-and-releases.md rule 40). While
 * `GUESTFLOW_RELEASE_PUBLIC_KEY` is unset, whoever can publish a GitHub release owns the fleet — so the
 * console says so at boot and keeps a host alert open (emailed every 24 h) until the key is set.
 */

const ALERT_KEY = 'release-signing';
const ALERT_TEXT = 'Versions non signées : sans GUESTFLOW_RELEASE_PUBLIC_KEY, toute version publiée sur GitHub s’exécute sur la console.';

/** → true when the key is configured. */
function checkReleaseSigning({ env, hostAlerts, log = (msg) => console.warn(msg) }) {
  if ((env.GUESTFLOW_RELEASE_PUBLIC_KEY || '').trim()) {
    hostAlerts.close(ALERT_KEY);
    return true;
  }
  log('[security] GUESTFLOW_RELEASE_PUBLIC_KEY is not set: releases are not signature-checked, and a release runs its own scripts under the console\'s user (licence key included). Set it (self-update rule 40).');
  hostAlerts.open({ key: ALERT_KEY, kind: 'release-signing', severity: 'warning', text: ALERT_TEXT });
  return false;
}

module.exports = { checkReleaseSigning, ALERT_KEY };
