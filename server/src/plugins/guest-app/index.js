/**
 * Application clients « Mon séjour » (specs/guest-app.md). Owns `/public/v1/guest/**`, `/api/guest-app/**`, its
 * tables and its settings. Nothing in the core behaves differently while it is absent (rule 22); the money and
 * the reservation write stay core.
 */

const sdk = require('../sdk');
const { MIGRATIONS, TABLES } = require('./migrations');
const settings = require('./settings');
const createLodgingsModel = require('./models/lodgingsModel');
const createSessionsModel = require('./models/sessionsModel');
const createStaysModel = require('./models/staysModel');
const createOrdersModel = require('./models/ordersModel');
const createItemsModel = require('./models/itemsModel');
const createStayLinesModel = require('./models/stayLinesModel');
const createStayLinksModel = require('./models/stayLinksModel');
const createServiceHoursModel = require('./models/serviceHoursModel');
const createBookletModel = require('./models/bookletModel');
const createMediaModel = require('./models/mediaModel');
const { createSoliomapFeed } = require('./soliomapFeed');
const { buildGuestSession } = require('./middleware/guestSession');
const { buildSessionController } = require('./controllers/sessionController');
const { buildLodgingsController } = require('./controllers/lodgingsController');
const { buildStayLinksController } = require('./controllers/stayLinksController');
const { buildItemsController } = require('./controllers/itemsController');
const { buildShopController } = require('./controllers/shopController');
const { buildServiceHoursController } = require('./controllers/serviceHoursController');
const { buildBookletController, buildBookletResolver } = require('./controllers/bookletController');
const { buildStudioController } = require('./controllers/studioController');
const { buildPublicRouter } = require('./routes/public');
const { buildAdminRouter } = require('./routes/admin');

const id = 'guest-app';
const DAY_MS = 24 * 60 * 60 * 1000;

const once = (build) => {
  let built = null;
  return () => {
    if (!built) built = build();
    return built;
  };
};

// The translation catalogue of the language served; tests hand one bound to their own database.
const coreTranslator = (lang) => sdk.coreModule('translationResolver').forLang(lang);

// The hourly slots come from the scheduler `hourly-resources` declares, never from that plugin's files.
const coreScheduler = () => sdk.core.resourceScheduler();

// The booklet photos sit under the instance's uploads, served by `/uploads` (specs/guest-app.md §5).
const coreUploadsDir = () => sdk.coreModule('instancePaths').uploadsDir();

function buildGuestApi({
  db, soliomapUrl, now = () => new Date(), limiters, translator = coreTranslator, scheduler = coreScheduler,
  appName = () => null, guestHost = () => null, uploadsDir = coreUploadsDir,
  soliomapFeed = createSoliomapFeed({ url: soliomapUrl, now }),
}) {
  const lodgings = once(() => createLodgingsModel(db()));
  const sessions = once(() => createSessionsModel(db()));
  const stays = once(() => createStaysModel(db()));
  const orders = once(() => createOrdersModel(db()));
  const items = once(() => createItemsModel(db()));
  const stayLines = once(() => createStayLinesModel(db()));
  const stayLinks = once(() => createStayLinksModel(db()));
  const serviceHours = once(() => createServiceHoursModel(db()));
  const booklet = once(() => createBookletModel(db()));
  const media = once(() => createMediaModel(db()));
  const guestSession = buildGuestSession({ sessions, stays, stayLinks, lodgings, now });
  const controller = buildSessionController({
    lodgings, sessions, stays, stayLinks, orders, guestSession, soliomapUrl, soliomapFeed, now,
  });
  const links = buildStayLinksController({
    stayLinks, stays, lodgings, guestHost, now,
  });
  const shop = buildShopController({ items, stayLines, orders, serviceHours, scheduler, translator, now });
  const resolver = buildBookletResolver({
    booklet, media, soldKeysOf: shop.soldKeysOf, shownKeys: controller.shownKeys,
  });
  return {
    publicRouter: buildPublicRouter({
      controller, shop, booklet: buildBookletController({ resolver, guestSession, lodgings }), guestSession, limiters,
    }),
    adminRouter: buildAdminRouter({
      lodgings: buildLodgingsController({
        lodgings, booklet, appName, guestHost, now,
      }),
      items: buildItemsController({ items }),
      serviceHours: buildServiceHoursController({ serviceHours }),
      studio: buildStudioController({
        booklet, media, lodgings, resolver, uploadsDir, now,
      }),
      stayLinks: links,
    }),
    sessions,
    // Rule 9bis — where the stay link is given: the SAS step and the reminder e-mails.
    stayLinkAvailable: links.available,
    stayAppUrl: links.emailUrl,
    shownKeysOf: controller.shownKeysOf,
    // Rule 35 — the slots the unpaid card orders hold, for every reader of the resource planning.
    heldSessions: (range) => orders().heldSessions({ ...range, now: now() }),
    serviceHoursConfigured: () => serviceHours().isConfigured(),
  };
}

function register(ctx) {
  ctx.migrations([...MIGRATIONS]);
  ctx.settings.declare(settings.DECLARED);
  ctx.pushChannel({ key: 'guest-orders', label: 'Commandes clients' });

  const rateLimiters = sdk.coreModule('rateLimiters');
  const api = buildGuestApi({
    db: () => ctx.db,
    soliomapUrl: () => ctx.settings.get('soliomapUrl'),
    appName: () => ctx.settings.get('appName'),
    guestHost: () => ctx.settings.get('guestHost'),
    limiters: {
      session: rateLimiters.guestSessionLimiter,
      lookup: rateLimiters.guestLookupLimiter,
      read: sdk.middleware.publicApiLimiter,
    },
  });
  // What the plugin still lacks: the guest host, and the service hours (rule 40 — unconstrained until set).
  ctx.setupStatus(() => [
    ctx.settings.get('guestHost') ? null : 'adresse de l’application à configurer',
    api.serviceHoursConfigured() ? null : 'horaires du service à configurer',
  ].filter(Boolean).join(', ') || null);
  ctx.resourceHolds(api.heldSessions);
  ctx.mount('/public/v1/guest', api.publicRouter, { public: true });
  ctx.mount('/api/guest-app', api.adminRouter);
  // Rule 9bis (a) — the reception runs the arrival SAS, where the stay link is shown and regenerated.
  ctx.reception([
    { method: 'GET', re: /^\/guest-app\/reservations\/\d+\/stay-link$/ },
    { method: 'POST', re: /^\/guest-app\/reservations\/\d+\/stay-link\/regenerate$/ },
  ]);
  // Rule 9bis (a) — the SAS « Portail » step becomes « Mon séjour » while this stay has a link to show.
  ctx.sasData((reservationId) => ({ available: api.stayLinkAvailable(reservationId) }));
  // Rule 9bis (b) — the reminder e-mails carry the stay link. `stayAppUrl` is a core variable (it falls back to
  // the gate link without this plugin), so only the flag is declared here.
  ctx.emailContext({
    tokens: [],
    flags: [{ name: 'hasStayApp', label: 'Si lien Mon séjour' }],
    build: (reservationId) => {
      const url = api.stayAppUrl(reservationId);
      return { tokens: { stayAppUrl: url }, flags: { hasStayApp: Boolean(url) } };
    },
  });

  ctx.jobs.every({
    name: 'session-purge',
    intervalMs: DAY_MS,
    bootDelayMs: 200 * 1000,
    run: async () => { api.sessions().purgeExpired(new Date()); },
  });

  ctx.data({
    tables: [...TABLES],
    describe: (db) => {
      const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
      const lines = [];
      const lodgings = count('guest_app_lodgings');
      if (lodgings) lines.push({ label: lodgings > 1 ? `${lodgings} logements configurés` : '1 logement configuré', count: lodgings });
      const orders = count('guest_orders');
      if (orders) lines.push({ label: orders > 1 ? `${orders} commandes clients` : '1 commande client', count: orders });
      const sessions = count('guest_sessions');
      if (sessions) lines.push({ label: sessions > 1 ? `${sessions} sessions clients` : '1 session client', count: sessions });
      return lines;
    },
  });
}

module.exports = { id, register, buildGuestApi };
