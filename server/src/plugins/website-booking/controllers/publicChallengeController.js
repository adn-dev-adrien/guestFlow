/**
 * GET /public/v1/booking-requests/challenge and the proof check in front of POST /booking-requests
 * (specs/public-request-abuse-and-grouping.md rules 1-5b + the transition edge case).
 *
 * The proof is required once the WordPress plugin has reported a version that solves challenges
 * (`lastSeenPluginVersion` ≥ CHALLENGE_PLUGIN_VERSION, recorded by settings.recordPluginVersion): until
 * then a request without one is accepted, so updating GuestFlow before the site never closes the form.
 * A request that carries a proof has it checked either way.
 */

const sdk = require('../../sdk');
const challenge = require('../challenge');
const store = require('../requestStore');
const settings = require('../settings');

const { ok, failT } = sdk.coreModule('publicHttp');

// The first guestflow-booking release whose drawer solves the challenge.
const CHALLENGE_PLUGIN_VERSION = '1.18.0';
const HOUR_MS = 60 * 60 * 1000;

function versionAtLeast(version, minimum) {
  const a = String(version || '').split('.').map(Number);
  const b = minimum.split('.').map(Number);
  if (a.length !== 3 || a.some((n) => !Number.isInteger(n))) return false;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
}

/** Whether the site's plugin solves challenges, so a request without proof is refused. */
function proofEnforced() {
  return versionAtLeast(settings.termsSettings().lastSeenPluginVersion, CHALLENGE_PLUGIN_VERSION);
}

const secret = () => sdk.secrets.getOrCreate(challenge.SECRET_NAME, 32);

function rememberPluginVersion(req) {
  const version = req.visitor && req.visitor.pluginVersion;
  if (version && settings.termsSettings().lastSeenPluginVersion !== version) settings.recordPluginVersion(version);
}

function issueChallenge(req, res) {
  const now = Date.now();
  const ipKey = challenge.ipKeyOf(req.visitor && req.visitor.ip);
  const difficulty = challenge.difficultyFor({
    addressRequestsLastHour: store.countRecent({ ipKey, windowMs: HOUR_MS, now }),
    requestsLastHour: store.countRecent({ windowMs: HOUR_MS, now }),
  });
  // The drawer asks for one as soon as it opens: the version it reports turns the requirement on.
  rememberPluginVersion(req);
  res.set('Cache-Control', 'no-store');
  return ok(res, challenge.issue({ secret: secret(), ipKey, difficulty, now }));
}

function requireProof(req, res, next) {
  const body = req.body || {};
  const ipKey = challenge.ipKeyOf(req.visitor && req.visitor.ip);
  const carriesProof = body.challenge !== undefined || body.nonce !== undefined;
  if (!carriesProof) {
    if (proofEnforced()) {
      return failT(res, req, 403, 'CHALLENGE_INVALID', 'challengeMissing', [{ field: 'challenge', issue: 'missing' }]);
    }
    store.logRequest(ipKey);
    return next();
  }
  const now = Date.now();
  const result = challenge.verify({ secret: secret(), challenge: body.challenge, nonce: body.nonce, ipKey, now });
  if (!result.ok) {
    return failT(res, req, 403, 'CHALLENGE_INVALID', 'challengeInvalid', [{ field: 'challenge', issue: result.reason }]);
  }
  if (!store.spendChallenge(result.challengeId, result.expiresAt, { now })) {
    return failT(res, req, 403, 'CHALLENGE_INVALID', 'challengeInvalid', [{ field: 'challenge', issue: 'used' }]);
  }
  store.logRequest(ipKey, { now });
  return next();
}

module.exports = { issueChallenge, requireProof, proofEnforced, versionAtLeast, CHALLENGE_PLUGIN_VERSION };
