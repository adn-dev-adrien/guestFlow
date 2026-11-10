/**
 * `GET /public/v1/guest/booklet`, `/booklet/pages/:slug`, `/booklet/search` — the lodging's last published
 * booklet, for a session or, in visitor mode, for the printed code (specs/guest-app.md rules 5, 16-20). The
 * language is applied per field, the lodging's facts fill the `wifi` and `contact` blocks, and a button the
 * session cannot follow is not sent (rule 18).
 *
 * The same resolution serves the studio's preview and search, on the draft (rules 49, 20).
 */

const sdk = require('../../sdk');
const { searchPages } = require('../booklet');
const { wifiView } = require('./sessionController');
const { languageOf } = require('../language');
const { fail, refusal } = require('../refusals');

const publicHttp = sdk.coreModule('publicHttp');

const MAX_CODE = 120;

/** Rule 11ter — the « Pas de wifi » message of a lodging without wifi (the stay texts' `noWifi` wording). */
const noWifiText = (name) => ({ fr: `À ${name}, il n’y a pas de wifi.`, en: `There is no wifi at ${name}.` });

function buildBookletResolver({ booklet, media, soldKeysOf, shownKeys }) {
  /** The lodging's facts the blocks read (rule 11ter): one password to change, the tile and the booklet follow. */
  async function lodgingFacts(lodging) {
    const hasWifi = lodging.wifi.available && lodging.wifi.network !== '';
    return {
      wifi: hasWifi ? await wifiView(lodging.wifi) : null,
      noWifi: noWifiText(lodging.name),
      contacts: lodging.contacts,
    };
  }

  /**
   * Rule 18 — what a button may open for this reader: an item only for a stay session whose lodging shows its
   * shop and sells that item; a visitor or a pre-arrival session never reaches the shop or the bath from here.
   */
  function availability(lodging, mode) {
    let shown = null;
    let sold = null;
    return (target) => {
      if (target.kind === 'url') return true;
      if (target.kind !== 'item' || mode !== 'stay') return false;
      shown = shown || shownKeys(lodging, mode);
      if (!shown.includes('shop')) return false;
      sold = sold || soldKeysOf(lodging.propertyId);
      return sold.has(`${target.itemKind}:${target.itemId}`);
    };
  }

  /** `{ draft: true }` reads the studio's draft, else the last published version. */
  async function resolve({ lodging, mode, lang, draft = false }) {
    return booklet().resolveBooklet(lodging.propertyId, lang, {
      facts: await lodgingFacts(lodging),
      mediaOf: media().viewer(),
      isAvailable: availability(lodging, mode),
    }, { draft });
  }

  return { resolve };
}

function buildBookletController({ resolver, guestSession, lodgings }) {
  /**
   * Rule 5 — a session, or the printed code in visitor mode. Sets `req.guest` for the module check; neither
   * answers like a dead session.
   */
  function reader(req, res, next) {
    const guest = guestSession.load(req);
    if (guest) {
      req.guest = guest;
      return next();
    }
    const code = req.query && req.query.lodgingCode;
    const lodging = typeof code === 'string' && code.length <= MAX_CODE ? lodgings().findEnabledByCode(code) : null;
    if (!lodging) return fail(res, refusal(401, 'SESSION_EXPIRED', 'sessionExpired'));
    req.guest = { lodging, mode: 'visitor', stay: null, session: null };
    return next();
  }

  const resolvedFor = (req) => resolver.resolve({
    lodging: req.guest.lodging, mode: req.guest.mode, lang: languageOf(req, req.guest.stay),
  });

  // GET /booklet — the index: the published version and its pages in the lodging's order.
  async function index(req, res) {
    const { version, pages } = await resolvedFor(req);
    return publicHttp.ok(res, {
      version,
      pages: pages.map(({ slug, icon, title, cover }) => ({ slug, icon, title, cover })),
    });
  }

  // GET /booklet/pages/:slug
  async function page(req, res) {
    const { pages } = await resolvedFor(req);
    const found = pages.find((p) => p.slug === req.params.slug);
    if (!found) return fail(res, refusal(404, 'PAGE_NOT_FOUND', 'pageNotFound'));
    return publicHttp.ok(res, found);
  }

  // GET /booklet/search?q= — rule 20: titles and texts, accents and case ignored, the matching sentence.
  async function search(req, res) {
    const { q } = req.query;
    if (typeof q !== 'string') return fail(res, refusal(400, 'INVALID_INPUT', 'searchRequired'));
    const { pages } = await resolvedFor(req);
    const found = searchPages(pages, q);
    if (found.error) return fail(res, refusal(400, 'INVALID_INPUT', found.error, found.params));
    return publicHttp.ok(res, found);
  }

  return {
    index, page, reader, search,
  };
}

module.exports = { buildBookletController, buildBookletResolver };
