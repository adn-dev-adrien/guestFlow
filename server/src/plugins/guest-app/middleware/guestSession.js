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

const cookieOptions = (expires) => ({ httpOnly: true, secure: true, sameSite: 'strict', path: COOKIE_PATH, expires });

const setSessionCookie = (res, token, expires) => res.cookie(COOKIE, token, cookieOptions(expires));
const clearSessionCookie = (res) => res.clearCookie(COOKIE, { httpOnly: true, secure: true, sameSite: 'strict', path: COOKIE_PATH });

function buildGuestSession({ sessions, stays, stayLinks, lodgings, now }) {
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
      clearSessionCookie(res);
      return publicHttp.fail(res, 401, 'SESSION_EXPIRED', 'Votre session a expiré.');
    }
    req.guest = guest;
    // The expiry follows the reservation: a moved stay moves the cookie with it.
    setSessionCookie(res, guest.token, new Date(guest.session.expiresAt));
    return next();
  }

  /** A stay's own data: a visitor session has none. */
  function requireStay(req, res, next) {
    if (!req.guest.stay) return publicHttp.fail(res, 403, 'STAY_REQUIRED', 'Cette action demande un séjour en cours.');
    return next();
  }

  return { load, requireSession, requireStay };
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
