/**
 * The guest's way in and what a session reads (specs/guest-app.md rules 1-11quater): the QR code, the
 * fallback lookup, the name confirmation, `/me` and `/lodging`.
 */

const QRCode = require('qrcode');
const sdk = require('../../sdk');
const { addDays, nextOpeningToday, parisDate, resolveLodging, resolveLookup } = require('../currentStay');
const { nameMatches } = require('../nameMatch');
const { shownModules, tilesOf } = require('../modules');
const { chooseHighlight, openingLine, statusLine, welcomeLine } = require('../homeHighlight');
const { setSessionCookie } = require('../middleware/guestSession');

const publicHttp = sdk.coreModule('publicHttp');
const { toParisIso } = sdk.coreModule('stayWindow');

const NOT_FOUND_MESSAGE = 'Nous n’avons pas trouvé ce séjour. Vérifiez le nom et le numéro.';
const MAX_NAME_FAILURES = 3;
const NAME_LOCK_MS = 60 * 60 * 1000;
const VISITOR_SESSION_MS = 24 * 60 * 60 * 1000;
const MAX_FIELD = 120;

const isText = (v) => typeof v === 'string' && v.trim() !== '' && v.length <= MAX_FIELD;
const SUPPORTED = new Set(['fr', 'en']);

/** Rule 19 — the language asked for, else the guest's, else the browser's, French by default. */
function languageOf(req, stay) {
  const asked = String((req.query && req.query.lang) || '').toLowerCase();
  if (SUPPORTED.has(asked)) return asked;
  const onFile = stay && String(stay.clientLanguage || '').toLowerCase();
  if (SUPPORTED.has(onFile)) return onFile;
  return /^en\b/i.test(String(req.headers['accept-language'] || '')) ? 'en' : 'fr';
}

const lodgingView = (lodging) => ({ id: lodging.propertyId, name: lodging.name, slug: lodging.slug });

function buildSessionController({ lodgings, sessions, stays, orders, guestSession, soliomapUrl, now }) {
  function factsOf(lodging) {
    return {
      ...lodgings().soldCounts(lodging.propertyId),
      // The key provider of rules 12-14 is not wired yet: no gate tile until it is.
      gateKey: false,
      wifiConfigured: lodging.wifi.available && lodging.wifi.network !== '',
      soliomapUrl: soliomapUrl(),
      contactCount: lodging.contacts.length,
    };
  }

  const shownFor = (lodging, mode, lang) => shownModules(lodging.modules, factsOf(lodging), mode, lang);

  function staysAround(propertyId, at) {
    const today = parisDate(at);
    return stays().aroundDates(propertyId, addDays(today, -1), addDays(today, 1));
  }

  function answer(res, { mode, lodging, opening }) {
    return publicHttp.ok(res, {
      mode,
      lodging: lodgingView(lodging),
      ...(opening ? { opensAt: opening.opensAt.toISOString() } : {}),
    });
  }

  /** Rule 4 — the same device, the same stay: its session goes on, its name confirmation with it. */
  function reusable(req, propertyId, reservationId) {
    const current = guestSession.load(req);
    if (!current || current.session.propertyId !== propertyId) return null;
    return current.session.reservationId === reservationId ? current : null;
  }

  // POST /sessions — rules 1, 2, 3, 5. A guessed, stale or disabled code all read the same (no oracle).
  function createFromCode(req, res) {
    const code = req.body && req.body.lodgingCode;
    const lodging = isText(code) ? lodgings().findEnabledByCode(code) : null;
    if (!lodging) return publicHttp.fail(res, 404, 'LODGING_NOT_FOUND', 'Ce code n’est pas reconnu.');
    const at = now();
    const resolved = resolveLodging(staysAround(lodging.propertyId, at), at);
    const reservationId = resolved.mode === 'stay' ? resolved.stay.id : null;
    const again = reusable(req, lodging.propertyId, reservationId);
    if (again) {
      setSessionCookie(res, again.token, new Date(again.session.expiresAt));
      return answer(res, { mode: again.mode, lodging, opening: resolved.opening });
    }
    // A visitor session ends when the stay's window opens: the app scans again and gets the stay.
    const visitorExpiry = resolved.opening ? resolved.opening.opensAt : new Date(at.getTime() + VISITOR_SESSION_MS);
    const { token, session } = sessions().create({
      propertyId: lodging.propertyId,
      reservationId,
      mode: resolved.mode,
      origin: 'qr',
      expiresAt: resolved.mode === 'stay' ? resolved.window.end : visitorExpiry,
      now: at,
    });
    setSessionCookie(res, token, new Date(session.expiresAt));
    return answer(res, { mode: resolved.mode, lodging, opening: resolved.opening });
  }

  // POST /sessions/lookup — rules 6, 7, 11quater. Every failure is the one generic 404, and the name is
  // compared even when no stay carries that number.
  function lookup(req, res) {
    const { lastName, reservationNumber } = req.body || {};
    const stay = isText(lastName) && isText(reservationNumber)
      ? stays().byReservationNumber(reservationNumber.trim())
      : null;
    const nameOk = nameMatches(lastName, [stay ? stay.clientLastName : '']);
    const at = now();
    const lodging = stay && lodgings().findEnabled(stay.propertyId);
    const resolved = stay && nameOk && lodging ? resolveLookup(stay, at) : null;
    if (!resolved) return publicHttp.fail(res, 404, 'STAY_NOT_FOUND', NOT_FOUND_MESSAGE);
    const again = reusable(req, stay.propertyId, stay.id);
    if (again) {
      sessions().confirmName(again.session.id, at);
      setSessionCookie(res, again.token, new Date(again.session.expiresAt));
      return answer(res, { mode: again.mode, lodging });
    }
    const { token, session } = sessions().create({
      propertyId: stay.propertyId,
      reservationId: stay.id,
      mode: resolved.mode,
      origin: 'lookup',
      expiresAt: resolved.window.end,
      nameConfirmedAt: at,
      now: at,
    });
    setSessionCookie(res, token, new Date(session.expiresAt));
    return answer(res, { mode: resolved.mode, lodging });
  }

  // POST /me/confirm-name — rule 33's lock, rule 7's comparison.
  function confirmName(req, res) {
    const { session, stay } = req.guest;
    if (session.nameConfirmedAt) return publicHttp.ok(res, { nameConfirmed: true });
    // A body that carries no name is a malformed request, not a wrong name: it spends no attempt.
    if (!isText(req.body && req.body.lastName)) return publicHttp.fail(res, 400, 'INVALID_INPUT', 'Saisissez votre nom de famille.');
    const at = now();
    const lockedUntil = session.nameLockedUntil ? new Date(session.nameLockedUntil) : null;
    if (lockedUntil && at < lockedUntil) {
      return res.status(423).json({ error: { code: 'NAME_LOCKED', message: 'Trop d’essais. Vous pouvez payer par carte.', lockedUntil: lockedUntil.toISOString() } });
    }
    if (nameMatches(req.body && req.body.lastName, [stay.clientLastName])) {
      sessions().confirmName(session.id, at);
      return publicHttp.ok(res, { nameConfirmed: true });
    }
    const after = sessions().recordNameFailure(session.id, {
      locksAt: MAX_NAME_FAILURES,
      lockedUntil: new Date(at.getTime() + NAME_LOCK_MS),
    });
    if (after.nameLockedUntil) {
      return res.status(423).json({ error: { code: 'NAME_LOCKED', message: 'Trop d’essais. Vous pouvez payer par carte.', lockedUntil: after.nameLockedUntil } });
    }
    return res.status(422).json({ error: { code: 'NAME_MISMATCH', message: 'Ce nom ne correspond pas à la réservation.', attemptsLeft: MAX_NAME_FAILURES - after.nameFailures } });
  }

  // GET /me — rule 8: this payload is the whole of what a session learns about its stay.
  function me(req, res) {
    const { stay, window, lodging, mode, session } = req.guest;
    const lang = languageOf(req, stay);
    const at = now();
    const shown = shownFor(lodging, mode, lang);
    const base = { mode, lodging: lodgingView(lodging), language: lang, tiles: tilesOf(shown) };
    if (!stay) {
      const opening = nextOpeningToday(staysAround(lodging.propertyId, at), at);
      return publicHttp.ok(res, {
        ...base,
        welcome: welcomeLine(lodging.name, lang),
        ...(opening ? { opensAt: opening.opensAt.toISOString(), openingLine: openingLine(opening, lang) } : {}),
      });
    }
    const highlight = mode === 'stay' ? chooseHighlight({
      stay,
      now: at,
      shown: shown.map((m) => m.key),
      orderReady: orders().deliveredRecently(stay.id, at),
      lang,
    }) : null;
    return publicHttp.ok(res, {
      ...base,
      guest: { firstName: stay.clientFirstName || '' },
      stay: {
        arrival: toParisIso(window.checkIn),
        departure: toParisIso(window.checkOut),
        partySize: ['adults', 'teens', 'children', 'babies'].reduce((sum, key) => sum + Number(stay[key] || 0), 0),
        statusLine: statusLine(stay, window, at, lang),
      },
      nameConfirmed: Boolean(session.nameConfirmedAt),
      ...(highlight ? { highlight } : {}),
    });
  }

  /** Rule 18 `wifi` — the join QR a phone scans: the WIFI: scheme escapes these characters. */
  async function wifiView(wifi) {
    const escape = (text) => String(text).replace(/([\;,:"])/g, '\\$1');
    const type = wifi.password ? 'WPA' : 'nopass';
    const joinQr = await QRCode.toDataURL(`WIFI:T:${type};S:${escape(wifi.network)};P:${escape(wifi.password)};;`);
    return { network: wifi.network, password: wifi.password, ...(wifi.note ? { note: wifi.note } : {}), joinQr };
  }

  // GET /lodging — a session, or the printed code in visitor mode (rule 5). Only what the lodging shows.
  async function lodging(req, res) {
    const guest = guestSession.load(req);
    const code = req.query && req.query.lodgingCode;
    const shownLodging = guest ? guest.lodging : (isText(code) && lodgings().findEnabledByCode(code));
    if (!shownLodging) return publicHttp.fail(res, 401, 'SESSION_EXPIRED', 'Votre session a expiré.');
    const lang = languageOf(req, guest && guest.stay);
    const shown = shownFor(shownLodging, guest ? guest.mode : 'visitor', lang);
    const has = (key) => shown.some((m) => m.key === key);
    const heroPath = lodgings().mediaPath(shownLodging.heroMediaId);
    return publicHttp.ok(res, {
      name: shownLodging.name,
      heroUrl: heroPath ? `/uploads/${heroPath}` : null,
      modules: shown,
      ...(has('wifi') ? { wifi: await wifiView(shownLodging.wifi) } : {}),
      contacts: has('contacts') ? shownLodging.contacts : [],
    });
  }

  /** The shown keys of the request's session, for `requireModule`. */
  const shownKeysOf = (req) => shownFor(req.guest.lodging, req.guest.mode).map((m) => m.key);

  return { confirmName, createFromCode, lodging, lookup, me, shownKeysOf };
}

module.exports = { buildSessionController, languageOf };
