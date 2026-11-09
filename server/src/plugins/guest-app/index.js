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
const createStockModel = require('./models/stockModel');
const { alertPush } = require('./stock');
const { parisDate } = require('./currentStay');
const hosting = require('./appHosting');
const { createSoliomapFeed } = require('./soliomapFeed');
const { buildGuestSession } = require('./middleware/guestSession');
const { buildSessionController } = require('./controllers/sessionController');
const { buildLodgingsController } = require('./controllers/lodgingsController');
const { buildStayLinksController } = require('./controllers/stayLinksController');
const { buildItemsController } = require('./controllers/itemsController');
const { buildShopController } = require('./controllers/shopController');
const { buildOrdersController, ORDER_SOURCE, ORDER_REFUND_LABELS } = require('./controllers/ordersController');
const { buildOrdersAdminController } = require('./controllers/ordersAdminController');
const { buildServiceHoursController } = require('./controllers/serviceHoursController');
const { buildBookletController, buildBookletResolver } = require('./controllers/bookletController');
const { buildStudioController } = require('./controllers/studioController');
const { buildStudioSettingsController } = require('./controllers/studioSettingsController');
const { buildPublicRouter } = require('./routes/public');
const { buildAdminRouter } = require('./routes/admin');
const { createGuestLimiters } = require('./rateLimiters');
const gate = require('./gate');
const stayAppEmail = require('./emailContext');

const id = 'guest-app';
const DAY_MS = 24 * 60 * 60 * 1000;
// Rule 37ter — the arrival sweep: idempotent, so it runs often and a stay counts within minutes of its arrival day.
const STOCK_SWEEP_MS = 5 * 60 * 1000;
const STOCK_EVENTS = Object.freeze(['reservation.created', 'reservation.updated', 'reservation.cancelled', 'reservation.deleted']);

/** The plugin's settings for a suite: the declared defaults, then what the suite writes. */
function memorySettings(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get: (key) => (values.has(key) ? values.get(key) : (settings.DECLARED.find((d) => d.key === key) || {}).default ?? null),
    set: (key, value) => { values.set(key, value); },
  };
}

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

// Rules 34-35, 44 — the order is written, and paid, on the core's money path; the staff is told by push.
const corePayments = () => sdk.core.payments;
const corePush = () => sdk.coreModule('pushService');

function buildGuestApi({
  db, soliomapUrl, now = () => new Date(), limiters, translator = coreTranslator, scheduler = coreScheduler,
  appName = () => null, soliomapEmbed = () => false, guestHost = () => null, uploadsDir = coreUploadsDir, maxOrderTotal = () => 500,
  soliomapFeed = createSoliomapFeed({ url: soliomapUrl, now }),
  commit = sdk.coreModule('midStayOrderCommit'), payments = corePayments, push = corePush,
  settingsStore = (() => { const store = memorySettings(); return () => store; })(), readGateUrl,
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
  const stock = once(() => createStockModel(db()));
  const fulfilment = () => settings.fulfilmentOf((key) => settingsStore().get(key));

  /** Rule 37quater — the low / out pushes a move of the stock made due, each once until the next restock. Best effort. */
  function alertStock(keys) {
    if (!keys || !keys.length) return;
    stock().alertsDue(keys, now()).forEach((alert) => {
      const [kind, itemId] = alert.key.split(':');
      const found = items().get(kind, itemId);
      const payload = { ...alertPush(alert, found ? found.core.title : ''), url: '/commandes-app' };
      Promise.resolve().then(() => push().sendToPref('guest-orders', payload)).catch(() => {});
    });
  }

  /** Rule 37ter — a reservation's counts brought to date, then the pushes it made due. */
  function reconcileStock(reservationId) {
    alertStock(stock().reconcile(reservationId, parisDate(now())));
  }

  /** Rule 37ter — the arrival day: every stay in progress, and every stay that took something and no longer should. */
  function sweepStock() {
    const today = parisDate(now());
    const ids = new Set([...stock().staysInProgress(today), ...stock().countedReservations()]);
    alertStock([...new Set([...ids].flatMap((reservationId) => stock().reconcile(reservationId, today)))]);
  }
  const guestSession = buildGuestSession({ sessions, stays, stayLinks, lodgings, now });
  const controller = buildSessionController({
    lodgings, sessions, stays, stayLinks, orders, guestSession, soliomapUrl, soliomapFeed, now, appName, soliomapEmbed,
    ...(readGateUrl ? { readGateUrl } : {}),
  });
  const links = buildStayLinksController({
    stayLinks, stays, lodgings, guestHost, now,
  });
  const shop = buildShopController({
    items, stayLines, orders, serviceHours, stock, scheduler, translator, now, fulfilment,
  });
  const orderBook = buildOrdersController({
    db, orders, stays, lodgings, shop, scheduler, serviceHours, commit, payments, push, maxOrderTotal, guestHost, now, stock, alertStock, fulfilment,
  });
  const resolver = buildBookletResolver({
    booklet, media, soldKeysOf: shop.soldKeysOf, shownKeys: controller.shownKeys,
  });
  return {
    publicRouter: buildPublicRouter({
      controller, shop, orders: orderBook, booklet: buildBookletController({ resolver, guestSession, lodgings }), guestSession, limiters, appName,
    }),
    adminRouter: buildAdminRouter({
      lodgings: buildLodgingsController({
        lodgings, booklet, appName, guestHost, now,
      }),
      items: buildItemsController({
        items, stock, alertStock, now, translator,
      }),
      studioSettings: buildStudioSettingsController({
        lodgings, settingsStore, soliomapFeed, now,
      }),
      serviceHours: buildServiceHoursController({ serviceHours }),
      studio: buildStudioController({
        booklet, media, lodgings, resolver, uploadsDir, now,
      }),
      stayLinks: links,
      orders: buildOrdersAdminController({ orders, stays, lodgings, now }),
    }),
    sessions,
    // Rule 9bis — where the stay link is given: the SAS step and the reminder e-mails.
    stayLinkAvailable: links.available,
    stayAppUrl: links.emailUrl,
    shownKeysOf: controller.shownKeysOf,
    // Rule 35 — the slots the unpaid card orders hold, for every reader of the resource planning.
    heldSessions: (range) => orders().heldSessions({ ...range, now: now() }),
    serviceHoursConfigured: () => serviceHours().isConfigured(),
    // Rules 35-36 — the order's side of its paid card link, and the expiry of the unpaid ones.
    orderPaid: orderBook.paid,
    expireOrders: orderBook.expireDue,
    // Rules 37ter-37quater — the stock follows every reservation, whoever wrote its lines.
    reconcileStock,
    sweepStock,
  };
}

function register(ctx) {
  ctx.migrations([...MIGRATIONS]);
  ctx.settings.declare(settings.DECLARED);
  ctx.pushChannel({ key: 'guest-orders', label: 'Commandes clients' });

  const api = buildGuestApi({
    db: () => ctx.db,
    soliomapUrl: () => ctx.settings.get('soliomapUrl'),
    appName: () => ctx.settings.get('appName'),
    soliomapEmbed: () => ['1', 1, true].includes(ctx.settings.get('soliomapEmbed')),
    guestHost: () => ctx.settings.get('guestHost'),
    maxOrderTotal: () => Number(ctx.settings.get('maxOrderTotal')) || 500,
    settingsStore: () => ctx.settings,
    limiters: {
      ...createGuestLimiters(),
      read: sdk.middleware.publicApiLimiter,
    },
  });
  // What the plugin still lacks: the guest host, and the service hours (rule 40 — unconstrained until set).
  ctx.setupStatus(() => [
    ctx.settings.get('guestHost') ? null : 'adresse de l’application à configurer',
    api.serviceHoursConfigured() ? null : 'horaires du service à configurer',
  ].filter(Boolean).join(', ') || null);
  ctx.resourceHolds(api.heldSessions);
  // Rules 35-36 — a paid card link of an order commits it, or flags its money « à rembourser ».
  ctx.paymentBasket({
    source: ORDER_SOURCE,
    paid: api.orderPaid,
    labels: ORDER_REFUND_LABELS,
  });
  ctx.mount('/public/v1/guest', api.publicRouter, { public: true });
  // Plan step 50 — the guest app on its own host, the studio at /studio for an admin (rule 47).
  const guestDist = (() => { let dir = null; return () => { if (!dir) dir = hosting.distDirOf('guest'); return dir; }; })();
  const studioDist = (() => { let dir = null; return () => { if (!dir) dir = hosting.distDirOf('studio'); return dir; }; })();
  ctx.webApp({
    key: 'guest',
    host: () => ctx.settings.get('guestHost') || null,
    handler: hosting.staticApp({
      dir: guestDist,
      csp: () => hosting.guestCsp({
        frameOrigin: hosting.soliomapFrameOrigin({ soliomapUrl: ctx.settings.get('soliomapUrl'), soliomapEmbed: ctx.settings.get('soliomapEmbed') }),
      }),
    }),
  });
  ctx.webApp({
    key: 'studio',
    path: '/studio',
    handler: hosting.adminOnly(hosting.staticApp({ dir: studioDist, base: '/studio', csp: () => hosting.studioCsp() })),
  });
  ctx.mount('/api/guest-app', api.adminRouter);
  // Rule 9bis (a) — the reception runs the arrival SAS, where the stay link is shown and regenerated; rules 43, 45 —
  // it prepares and delivers the orders.
  ctx.reception([
    { method: 'GET', re: /^\/guest-app\/reservations\/\d+\/stay-link$/ },
    { method: 'POST', re: /^\/guest-app\/reservations\/\d+\/stay-link\/regenerate$/ },
    { method: 'GET', re: /^\/guest-app\/orders$/ },
    { method: 'POST', re: /^\/guest-app\/orders\/\d+\/delivered$/ },
    { method: 'GET', re: /^\/guest-app\/planning\/order-cards$/ },
    // Rule 37quater — the reservation editor's « Stock : épuisé » warning.
    { method: 'GET', re: /^\/guest-app\/stock$/ },
  ]);
  // Rule 9bis (a) — the SAS « Portail » step becomes « Mon séjour » while this stay has a link to show.
  ctx.sasData((reservationId) => ({ available: api.stayLinkAvailable(reservationId) }));
  // Rule 9bis (b) — the reminder e-mails' « Lien Mon séjour », declared by this plugin (emailContext.js).
  ctx.emailContext({
    tokens: [...stayAppEmail.TOKENS],
    flags: [...stayAppEmail.FLAGS],
    build: (reservationId) => stayAppEmail.stayAppEmailContext({ stayUrl: api.stayAppUrl(reservationId), gateUrl: gate.keyUrlOf(reservationId) }),
  });

  // Rule 36 — every minute, an order unpaid 30 minutes on expires and its slots go back to the planning.
  ctx.jobs.every({
    name: 'order-expiry',
    intervalMs: 60 * 1000,
    bootDelayMs: 30 * 1000,
    run: async () => { api.expireOrders(); },
  });

  // Rule 37ter — the website and the staff sell too: every reservation event brings the stock to date.
  STOCK_EVENTS.forEach((name) => ctx.events.on(name, ({ reservationId } = {}) => {
    if (reservationId) api.reconcileStock(reservationId);
  }));
  ctx.jobs.every({
    name: 'stock-arrivals',
    intervalMs: STOCK_SWEEP_MS,
    bootDelayMs: 45 * 1000,
    run: async () => { api.sweepStock(); },
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

module.exports = {
  id, register, buildGuestApi, memorySettings,
};
