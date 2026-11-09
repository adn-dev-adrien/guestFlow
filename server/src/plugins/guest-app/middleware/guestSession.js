/**
 * Reads `gf_guest`, loads the session and re-derives its stay's window on every request (specs/guest-app.md
 * rules 1, 4, 9, 11quater). A dead session answers 401 `SESSION_EXPIRED` and loses its cookie; the app then
 * exchanges its stored stay link again, or falls back to the lodging's visitor mode. A session opened from a
 * stay link dies with that link (« Régénérer le lien »).
 */

const sdk = require('../../sdk');
const { deriveSession } = require('../currentStay');

const publicHttp = sdk.coreModule('publicHttp');

const COOKIE = 'gf_guest';
const COOKIE_PATH = '/public/v1/guest';

function readCookie(req) {
  const header = String(req.headers.cookie || '');
  const found = header.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`));
  return found ? found.slice(COOKIE.length + 1) : null;
}

// `Secure` exactly when the core's own session cookie is (`HTTPS_ENABLED`): over plain HTTP a browser drops a Secure
// cookie, and no guest session would ever hold.
const cookieOptions = (secure) => ({ httpOnly: true, secure: Boolean(secure), sameSite: 'strict', path: COOKIE_PATH });

const setSessionCookie = (res, token, expires, { secure = true } = {}) => res.cookie(COOKIE, token, { ...cookieOptions(secure), expires });
const clearSessionCookie = (res, { secure = true } = {}) => res.clearCookie(COOKIE, cookieOptions(secure));

const coreHttps = () => sdk.coreModule('securityConfig').shouldEnforceHttps();

function buildGuestSession({
  sessions, stays, stayLinks, lodgings, now, httpsEnabled = coreHttps,
}) {
  const setCookie = (res, token, expires) => setSessionCookie(res, token, expires, { secure: httpsEnabled() });
  const clearCookie = (res) => clearSessionCookie(res, { secure: httpsEnabled() });

  /** → { session, token, stay, window, lodging, mode } or null. */
  function load(req) {
    const token = readCookie(req);
    const session = sessions().findByToken(token);
    if (!session) return null;
    const at = now();
    const lodging = lodgings().findEnabled(session.propertyId);
    if (!lodging) return null;
    if (session.stayLinkId !== null && !stayLinks().isLive(session.stayLinkId)) return null;
    if (session.reservationId === null) {
      if (at >= new Date(session.expiresAt)) return null;
      return { session: sessions().touch(session.id, { mode: 'visitor', expiresAt: session.expiresAt, now: at }), token, stay: null, window: null, lodging, mode: 'visitor' };
    }
    const stay = stays().byId(session.reservationId);
    const derived = deriveSession(session, stay, at);
    if (!derived) return null;
    return {
      session: sessions().touch(session.id, { mode: derived.mode, expiresAt: derived.expiresAt, now: at }),
      token,
      stay,
      window: derived.window,
      lodging,
      mode: derived.mode,
    };
  }

  function requireSession(req, res, next) {
    const guest = load(req);
    if (!guest) {
      clearCookie(res);
      return publicHttp.fail(res, 401, 'SESSION_EXPIRED', 'Votre session a expiré.');
    }
    req.guest = guest;
    // The expiry follows the reservation: a moved stay moves the cookie with it.
    setCookie(res, guest.token, new Date(guest.session.expiresAt));
    return next();
  }

  /**
   * §4.3 — what a stay session alone reaches (slots, delivery times, orders): a visitor has no stay, and a
   * pre-arrival guest reads the shop's catalogue only (rule 27).
   */
  function requireStay(req, res, next) {
    if (!req.guest.stay || req.guest.mode !== 'stay') return publicHttp.fail(res, 403, 'STAY_REQUIRED', 'Cette action demande un séjour en cours.');
    return next();
  }

  return {
    load, requireSession, requireStay, setCookie, clearCookie,
  };
}

/**
 * Rule 11bis — the endpoints of a module off for the lodging do not exist for its sessions. `shownKeysOf(req)`
 * hands the shown keys; hiding is enforced here, not only in the app.
 */
function requireModule(key, shownKeysOf) {
  return (req, res, next) => {
    if (shownKeysOf(req).includes(key)) return next();
    return publicHttp.fail(res, 404, 'MODULE_OFF', 'Ce service n’est pas proposé dans ce logement.');
  };
}

module.exports = { COOKIE, buildGuestSession, clearSessionCookie, readCookie, requireModule, setSessionCookie };
