/**
 * The guest's way in and what a session reads (specs/guest-app.md rules 1-11quater): the stay link, the
 * lodging poster (visitor mode only), the fallback lookup, `/me` and `/lodging`. The stay link proves the
 * stay: no name is ever asked of a guest who holds it (rules 2, 33).
 */

const QRCode = require('qrcode');
const sdk = require('../../sdk');
const registry = require('../../sdk/registry');
const {
  openingToday, preArrivalOpensAt, resolveLink, resolveLookup,
} = require('../currentStay');
const { nameMatches } = require('../nameMatch');
const { shownModules, tilesOf } = require('../modules');
const { chooseHighlight, openingLine, statusLine, welcomeLine } = require('../homeHighlight');
const { setSessionCookie } = require('../middleware/guestSession');
const { pickSuggestion } = require('../soliomapFeed');

const publicHttp = sdk.coreModule('publicHttp');
const { toParisIso } = sdk.coreModule('stayWindow');

const NOT_FOUND_MESSAGE = 'Nous n’avons pas trouvé ce séjour. Vérifiez le nom et le numéro.';
const UNKNOWN_CODE_MESSAGE = 'Ce code n’est pas reconnu.';
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

/** Rule 18 `wifi` — the join QR a phone scans: the WIFI: scheme escapes these characters. */
async function wifiView(wifi) {
  const escape = (text) => String(text).replace(/([\;,:"])/g, '\\$1');
  const type = wifi.password ? 'WPA' : 'nopass';
  const joinQr = await QRCode.toDataURL(`WIFI:T:${type};S:${escape(wifi.network)};P:${escape(wifi.password)};;`);
  return { network: wifi.network, password: wifi.password, ...(wifi.note ? { note: wifi.note } : {}), joinQr };
}

function buildSessionController({
  lodgings, sessions, stays, stayLinks, orders, guestSession, soliomapUrl, soliomapFeed, now,
}) {
  function factsOf(lodging) {
    return {
      ...lodgings().soldCounts(lodging.propertyId),
      gateAccess: registry.isLive('gate-access'),
      wifiConfigured: lodging.wifi.available && lodging.wifi.network !== '',
      soliomapUrl: soliomapUrl(),
      contactCount: lodging.contacts.length,
    };
  }

  const shownFor = (lodging, mode, lang) => shownModules(lodging.modules, factsOf(lodging), mode, lang);

  const unknownCode = (res) => publicHttp.fail(res, 404, 'CODE_NOT_FOUND', UNKNOWN_CODE_MESSAGE);

  function answer(res, { mode, lodging, opensAt, ended }) {
    return publicHttp.ok(res, {
      mode,
      lodging: lodgingView(lodging),
      ...(opensAt ? { opensAt: opensAt.toISOString() } : {}),
      ...(ended ? { ended: true } : {}),
    });
  }

  /** Rule 4 — the same device, the same stay, the same phase: its session goes on. */
  function reusable(req, { propertyId, reservationId, mode }) {
    const current = guestSession.load(req);
    if (!current || current.session.propertyId !== propertyId) return null;
    return current.session.reservationId === reservationId && current.mode === mode ? current : null;
  }

  function open(req, res, {
    lodging, reservationId = null, mode, origin, stayLinkId = null, expiresAt, opensAt = null, ended = false,
  }) {
    const at = now();
    const again = reusable(req, { propertyId: lodging.propertyId, reservationId, mode });
    if (again) {
      setSessionCookie(res, again.token, new Date(again.session.expiresAt));
      return answer(res, { mode, lodging, opensAt, ended });
    }
    const { token, session } = sessions().create({
      propertyId: lodging.propertyId, reservationId, mode, origin, stayLinkId, expiresAt, now: at,
    });
    setSessionCookie(res, token, new Date(session.expiresAt));
    return answer(res, { mode, lodging, opensAt, ended });
  }

  const visitorExpiry = (at) => new Date(at.getTime() + VISITOR_SESSION_MS);

  // Rules 1, 2, 4 — the stay link. A guessed, stale or revoked token, a cancelled stay and a lodging off all
  // read like an unknown code (no oracle).
  function openFromLink(req, res, stayToken) {
    const link = isText(stayToken) ? stayLinks().findLiveByToken(stayToken) : null;
    const stay = link && stays().byId(link.reservationId);
    const lodging = stay && lodgings().findEnabled(stay.propertyId);
    const at = now();
    const resolved = lodging ? resolveLink(stay, at) : null;
    if (!resolved) return unknownCode(res);
    const common = { lodging, origin: 'link', stayLinkId: link.id };
    if (resolved.mode === 'stay') {
      return open(req, res, {
        ...common, reservationId: stay.id, mode: 'stay', expiresAt: resolved.window.end,
      });
    }
    if (resolved.mode === 'preArrival') {
      return open(req, res, {
        ...common, reservationId: stay.id, mode: 'preArrival', expiresAt: resolved.window.start, opensAt: resolved.window.start,
      });
    }
    // Before J-7 the visitor session ends at J-7 at the latest, so the app's next exchange opens the pre-arrival.
    const expiry = visitorExpiry(at);
    const preArrival = preArrivalOpensAt(stay);
    return open(req, res, {
      ...common,
      mode: 'visitor',
      expiresAt: !resolved.ended && preArrival < expiry ? preArrival : expiry,
      ended: Boolean(resolved.ended),
    });
  }

  // Rule 3 — the lodging poster opens its visitor mode, never a stay, at any time.
  function openFromPoster(req, res, lodgingCode) {
    const lodging = isText(lodgingCode) ? lodgings().findEnabledByCode(lodgingCode) : null;
    if (!lodging) return unknownCode(res);
    return open(req, res, {
      lodging, mode: 'visitor', origin: 'poster', expiresAt: visitorExpiry(now()),
    });
  }

  // POST /sessions — `{ stayToken }` or `{ lodgingCode }` (§4.3); the stay link wins when both are sent.
  function createSession(req, res) {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (body.stayToken !== undefined) return openFromLink(req, res, body.stayToken);
    return openFromPoster(req, res, body.lodgingCode);
  }

  // POST /sessions/lookup — rules 6, 7, 11quater. Every failure is the one generic 404, and the name is
  // compared even when no stay carries that number.
  function lookup(req, res) {
    const { lastName, reservationNumber } = req.body || {};
    const stay = isText(lastName) && isText(reservationNumber)
      ? stays().byReservationNumber(reservationNumber.trim())
      : null;
    const nameOk = nameMatches(lastName, [stay ? stay.clientLastName : '']);
    const lodging = stay && lodgings().findEnabled(stay.propertyId);
    const resolved = stay && nameOk && lodging ? resolveLookup(stay, now()) : null;
    if (!resolved) return publicHttp.fail(res, 404, 'STAY_NOT_FOUND', NOT_FOUND_MESSAGE);
    return open(req, res, {
      lodging, reservationId: stay.id, mode: resolved.mode, origin: 'lookup', expiresAt: resolved.window.end,
    });
  }

  /** Rule 15bis — one dated Soliomap event for a stay or pre-arrival session, while the lodging shows Soliomap. */
  async function suggestionFor({ mode, stay, shown, at, lang }) {
    if (!shown.some((m) => m.key === 'soliomap')) return null;
    const activities = await soliomapFeed.activities();
    return pickSuggestion(activities, { mode, stay, now: at, lang, soliomapUrl: soliomapUrl() });
  }

  // GET /me — rule 8: this payload is the whole of what a session learns about its stay.
  async function me(req, res) {
    const { stay, window, lodging, mode } = req.guest;
    const lang = languageOf(req, stay);
    const at = now();
    const shown = shownFor(lodging, mode, lang);
    const base = { mode, lodging: lodgingView(lodging), language: lang, tiles: tilesOf(shown) };
    // Rule 3 — a visitor learns nothing of any stay, not even that one starts today.
    if (!stay) return publicHttp.ok(res, { ...base, welcome: welcomeLine(lodging.name, lang) });
    const opening = mode === 'preArrival' ? openingToday(stay, window, at) : null;
    const highlight = mode === 'stay' ? chooseHighlight({
      stay,
      now: at,
      shown: shown.map((m) => m.key),
      orderReady: orders().deliveredRecently(stay.id, at),
      lang,
    }) : null;
    const suggestion = await suggestionFor({ mode, stay, shown, at, lang });
    return publicHttp.ok(res, {
      ...base,
      guest: { firstName: stay.clientFirstName || '' },
      stay: {
        arrival: toParisIso(window.checkIn),
        departure: toParisIso(window.checkOut),
        partySize: ['adults', 'teens', 'children', 'babies'].reduce((sum, key) => sum + Number(stay[key] || 0), 0),
        statusLine: statusLine(stay, window, at, lang),
      },
      ...(opening ? { opensAt: opening.opensAt.toISOString(), openingLine: openingLine(opening, lang) } : {}),
      ...(suggestion ? { suggestion } : {}),
      ...(highlight ? { highlight } : {}),
    });
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

  /** The keys a lodging shows a session of this mode. */
  const shownKeys = (shownLodging, mode) => shownFor(shownLodging, mode).map((m) => m.key);

  /** The shown keys of the request's session, for `requireModule`. */
  const shownKeysOf = (req) => shownKeys(req.guest.lodging, req.guest.mode);

  return {
    createSession, lodging, lookup, me, shownKeys, shownKeysOf,
  };
}

module.exports = { buildSessionController, languageOf, wifiView };
