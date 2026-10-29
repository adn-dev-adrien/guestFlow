/**
 * Release signing is the only barrier between a published release and the licence key: the console runs
 * each release's own scripts as its own unix user (specs/self-update-and-releases.md rule 40). While
 * `GUESTFLOW_RELEASE_PUBLIC_KEY` is unset, whoever can publish a GitHub release owns the fleet — so the
 * console says so at boot and keeps a host alert open (emailed every 24 h) until the key is set.
 */

const { releaseSignature } = require('./gf');

const ALERT_KEY = 'release-signing';
const TEXTS = {
  unset: 'Versions non signées : sans GUESTFLOW_RELEASE_PUBLIC_KEY, toute version publiée sur GitHub s’exécute sur la console.',
  unreadable: 'Versions non signées : GUESTFLOW_RELEASE_PUBLIC_KEY est illisible, aucune version n’est installable.',
};

/** → true when a readable key is configured. */
function checkReleaseSigning({ env, hostAlerts, log = (msg) => console.warn(msg) }) {
  const configured = (env.GUESTFLOW_RELEASE_PUBLIC_KEY || '').trim();
  if (configured && releaseSignature.toKey(configured)) {
    hostAlerts.close(ALERT_KEY);
    return true;
  }
  const reason = configured ? 'unreadable' : 'unset';
  log(configured
    ? '[security] GUESTFLOW_RELEASE_PUBLIC_KEY is not a readable Ed25519 public key: no release can be installed (self-update rule 41).'
    : '[security] GUESTFLOW_RELEASE_PUBLIC_KEY is not set: releases are not signature-checked, and a release runs its own scripts under the console\'s user (licence key included). Set it (self-update rule 40).');
  hostAlerts.open({ key: ALERT_KEY, kind: 'release-signing', severity: 'warning', text: TEXTS[reason] });
  return false;
}

module.exports = { checkReleaseSigning, ALERT_KEY };
