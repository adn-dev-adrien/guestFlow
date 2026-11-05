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
const { buildGuestSession } = require('./middleware/guestSession');
const { buildSessionController } = require('./controllers/sessionController');
const { buildLodgingsController } = require('./controllers/lodgingsController');
const { buildItemsController } = require('./controllers/itemsController');
const { buildShopController } = require('./controllers/shopController');
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

function buildGuestApi({ db, soliomapUrl, now = () => new Date(), limiters, translator = coreTranslator }) {
  const lodgings = once(() => createLodgingsModel(db()));
  const sessions = once(() => createSessionsModel(db()));
  const stays = once(() => createStaysModel(db()));
  const orders = once(() => createOrdersModel(db()));
  const items = once(() => createItemsModel(db()));
  const stayLines = once(() => createStayLinesModel(db()));
  const guestSession = buildGuestSession({ sessions, stays, lodgings, now });
  const controller = buildSessionController({ lodgings, sessions, stays, orders, guestSession, soliomapUrl, now });
  const shop = buildShopController({ items, stayLines, orders, translator, now });
  return {
    publicRouter: buildPublicRouter({ controller, shop, guestSession, limiters }),
    adminRouter: buildAdminRouter({ lodgings: buildLodgingsController({ lodgings }), items: buildItemsController({ items }) }),
    sessions,
    shownKeysOf: controller.shownKeysOf,
  };
}

function register(ctx) {
  ctx.migrations([...MIGRATIONS]);
  ctx.settings.declare(settings.DECLARED);
  ctx.pushChannel({ key: 'guest-orders', label: 'Commandes clients' });
  ctx.setupStatus(() => (ctx.settings.get('guestHost') ? null : 'adresse de l’application à configurer'));

  const rateLimiters = sdk.coreModule('rateLimiters');
  const api = buildGuestApi({
    db: () => ctx.db,
    soliomapUrl: () => ctx.settings.get('soliomapUrl'),
    limiters: {
      session: rateLimiters.guestSessionLimiter,
      lookup: rateLimiters.guestLookupLimiter,
      read: sdk.middleware.publicApiLimiter,
    },
  });
  ctx.mount('/public/v1/guest', api.publicRouter, { public: true });
  ctx.mount('/api/guest-app', api.adminRouter);

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
