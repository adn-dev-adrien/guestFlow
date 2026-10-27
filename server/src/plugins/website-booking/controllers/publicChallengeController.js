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

/**
 * Whether the site's plugin solves challenges, so a request without proof is refused. Sticky (rule
 * 24): once a solving version was seen, a later report of an older one — or a forged header — never
 * switches the proof off again. There is no reset.
 */
function proofEnforced() {
  if (settings.proofEnforcedSince()) return true;
  if (!versionAtLeast(settings.termsSettings().lastSeenPluginVersion, CHALLENGE_PLUGIN_VERSION)) return false;
  settings.markProofEnforced();
  return true;
}

const secret = () => sdk.secrets.getOrCreate(challenge.SECRET_NAME, 32);

function rememberPluginVersion(req) {
  const version = req.visitor && req.visitor.pluginVersion;
  if (version && settings.termsSettings().lastSeenPluginVersion !== version) settings.recordPluginVersion(version);
  if (version && versionAtLeast(version, CHALLENGE_PLUGIN_VERSION) && !settings.proofEnforcedSince()) settings.markProofEnforced();
}

function issueChallenge(req, res) {
  const now = Date.now();
  const ipKey = challenge.ipKeyOf(req.visitor && req.visitor.ip);
  // Rule 4 as written, restored by rule 29: the requests the address MADE in the hour raise the
  // difficulty, never the challenges it was handed — a page view costs a guest nothing. Fetching
  // challenges ahead is bounded elsewhere: 15 minutes of validity, the per-visitor limiters.
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
  // Rule 29 — judged at the difficulty signed into it when it was issued: the HMAC is what makes that
  // number trustworthy. A challenge fetched just before a flood or before the address's previous send
  // stays valid; nobody is refused because the hour's total moved under them.
  if (!store.spendChallenge(result.challengeId, result.expiresAt, { now })) {
    return failT(res, req, 403, 'CHALLENGE_INVALID', 'challengeInvalid', [{ field: 'challenge', issue: 'used' }]);
  }
  store.logRequest(ipKey, { now });
  return next();
}

module.exports = { issueChallenge, requireProof, proofEnforced, versionAtLeast, CHALLENGE_PLUGIN_VERSION };
