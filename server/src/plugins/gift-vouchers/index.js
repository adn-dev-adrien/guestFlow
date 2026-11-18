/**
 * Gift vouchers (specs/gift-vouchers.md, specs/gift-voucher-campaigns.md). Owns `/public/v1/gift-vouchers/**`, `/api/gift-vouchers/**`, its tables and
 * its settings. Nothing in the core behaves differently while it is absent (rule 1); a voucher is an amount in euros
 * whose balance is the sum of its ledger (rules 5, 11), sold from a campaign — a free amount for a stay, or a composed content.
 */

const sdk = require('../sdk');
const { MIGRATIONS, TABLES } = require('./migrations');
const settings = require('./settings');
const createVouchersModel = require('./models/vouchersModel');
const createOrdersModel = require('./models/ordersModel');
const createMovementsModel = require('./models/movementsModel');
const createChecksModel = require('./models/checksModel');
const { createIssuance } = require('./issuance');
const createCampaignsModel = require('./models/campaignsModel');
const { createCatalogueView } = require('./catalogueView');
const { createOfferService } = require('./offerService');
const { createCheckLimits } = require('./rateLimiters');
const { createProof } = require('./proof');
const { createReceipt } = require('./receipt');
const { createBooks } = require('./books');
const { createOrderPaid, SOURCE } = require('./orderPaid');
const { renderVoucherPdf } = require('./voucherPdf');
const { createRedemption, SOURCE: PREPAID_SOURCE, LABEL: PREPAID_LABEL } = require('./redemption');
const { buildStayController } = require('./controllers/stayController');
const { buildAdminController } = require('./controllers/adminController');
const { buildPublicCheckController } = require('./controllers/publicCheckController');
const { buildPublicOrdersController } = require('./controllers/publicOrdersController');
const { buildCampaignsController } = require('./controllers/campaignsController');
const { buildAdminRouter } = require('./routes/admin');
const { buildPublicRouter } = require('./routes/public');

const id = 'gift-vouchers';
const PEPPER_NAME = 'GIFT_VOUCHER_PEPPER';
const PUSH_CHANNEL = 'gift-voucher-checks';
const DAY_MS = 24 * 60 * 60 * 1000;
const RECEIPT_RETRY_MS = 15 * 60 * 1000;
const HOLD_CHECK_MS = 60 * 60 * 1000;
const ERASE_REFUSAL = 'Des bons ont encore un solde : les annuler ou attendre leur expiration avant d’effacer les données.';
const PAUSED_ITEM = Object.freeze({
  title: 'Vérification des bons cadeaux suspendue',
  detail: 'Trop d’essais de codes en une heure : les vérifications publiques sont refusées pendant 30 minutes.',
});

const once = (build) => {
  let built = null;
  return () => {
    if (built === null) built = build();
    return built;
  };
};

/** The plugin's settings for a suite: the declared defaults, then what the suite writes. */
function memorySettings(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get: (key) => (values.has(key) ? values.get(key) : (settings.DECLARED.find((d) => d.key === key) || {}).default ?? null),
    set: (key, value) => { values.set(key, value); },
  };
}

/** Rule 32 — a pepper that is gone while vouchers exist is never drawn again: the plugin refuses to register. */
function assertPepperKept({ hasVouchers, env = process.env }) {
  if (String(env.GIFT_VOUCHER_PEPPER || '').trim() || !hasVouchers()) return;
  throw new Error(`gift-vouchers: ${PEPPER_NAME} is missing from .env.local while vouchers exist; restore it from the backup (a new one would make every issued code unverifiable)`);
}

function tableHasRows(db) {
  try {
    return typeof db.prepare('SELECT 1 FROM gift_vouchers LIMIT 1').get() === 'object';
  } catch {
    return false;
  }
}

/** The home's « À traiter » item while the public checks are paused (rule 33). */
const summarizeChecks = (payload) => (payload && payload.paused ? { count: 1, ...PAUSED_ITEM, severity: 'warning' } : null);

/** A user's display name from the core `users` table (a read); null when there is no such user or table. */
function userNameFrom(db) {
  return (id) => {
    try {
      const row = db.prepare('SELECT firstName, lastName, email FROM users WHERE id = ?').get(id);
      if (!row) return null;
      return [row.firstName, row.lastName].filter(Boolean).join(' ').trim() || row.email || null;
    } catch {
      return null;
    }
  };
}

function buildGiftVouchersApi({
  db, pepper, encrypt, decrypt, settingsStore = () => memorySettings(), now = () => new Date(), quote, pow, powSecret, guard,
  sendMail, paymentMethods, userName = userNameFrom(db), companyName, pageUrl, bookingUrl, termsVersionId = () => null, onlineSaleAvailable = () => false,
  payments, siteOrigin = () => '', limiters = {}, isConverted = () => false, stayOf = () => null, collectedCents = () => 0, receipts = null,
  randomBytes, onCheckLimitsTrip = () => {}, transaction = (fn) => db.transaction(fn)(),
  // The engine and the catalogue the campaigns are priced and picked from: the core's, unless a suite stands in.
  engine = { quote: (request) => sdk.coreModule('standaloneSale').quote(request) },
  catalogue = createCatalogueView({ db, articles: sdk.coreModule('articles') }),
}) {
  const get = (key) => settingsStore().get(key);
  const vouchers = createVouchersModel(db);
  const orders = createOrdersModel(db, { now });
  const movements = createMovementsModel(db, { now });
  const checks = createChecksModel(db, { now });
  const campaigns = createCampaignsModel(db, { now });
  const issuance = createIssuance({
    db, vouchers, orders, movements, campaigns, pepper, encrypt, now, randomBytes,
  });
  const checkLimits = createCheckLimits({ checks, now, onTrip: onCheckLimitsTrip });
  const offerService = createOfferService({
    campaigns, orders, issuance, catalogue, engine, quoteStay: quote, payments, transaction, now,
  });
  const respond = sdk.coreModule('publicHttp');
  const ipOf = (req) => pow.ipKeyOf(req.visitor && req.visitor.ip ? req.visitor.ip : req.ip) || 'unknown';

  const receipt = createReceipt({
    vouchers, orders, movements, transaction, sendMail, settingsGet: get, pageUrl, now,
  });
  const books = createBooks({ vouchers });
  const proof = createProof({ pow, secret: powSecret });
  const admin = buildAdminController({
    vouchers, movements, offerService, campaigns, transaction, paymentMethods, userName, decrypt, receipt, renderPdf: renderVoucherPdf,
    brand: companyName, bookingUrl, sendMail, now,
  });
  const campaignsAdmin = buildCampaignsController({ campaigns, catalogue, offerService });
  const check = buildPublicCheckController({
    vouchers, checks, limits: checkLimits, pepper, proof, ipOf, now, respond,
  });
  const redemption = createRedemption({
    db,
    vouchers,
    movements,
    checks,
    limits: checkLimits,
    pepper,
    ipOf: (visitor) => pow.ipKeyOf(visitor.ip) || 'unknown',
    resourceName: (id) => (catalogue.element(`resource:${id}`) || {}).label || null,
    now,
    transaction,
  });
  const stays = buildStayController({
    vouchers, movements, redemption, pepper, transaction, stayOf, collectedCents, receipts, now,
  });
  const offer = buildPublicOrdersController({
    offerService, termsVersionId, available: onlineSaleAvailable, brand: companyName, respond, orders, vouchers, proof, pepper, ipOf, payments, siteOrigin,
    decrypt, renderPdf: renderVoucherPdf, bookingUrl, now,
  });

  return {
    adminRouter: buildAdminRouter({ admin, stays, campaigns: campaignsAdmin }),
    publicRouter: buildPublicRouter({
      guard, offer, check, limiters,
    }),
    vouchers,
    orders,
    movements,
    checks,
    campaigns,
    offerService,
    catalogue,
    issuance,
    receipt,
    orderPaid: createOrderPaid({
      orders, movements, issuance, receipt,
    }),
    checkLimits,
    salesBetween: (window) => books.salesBetween(window),
    purgeStaleOrders: () => orders.purgeStalePending(),
    retryReceipts: () => receipt.retryPending(),
    purgeOldChecks: () => checks.purgeOld(),
    releaseLapsedHolds: () => redemption.releaseLapsed({ isConverted }),
    redemption,
    stays,
    attention: { handler: (req, res) => res.json({ paused: checkLimits.isPaused() }), summarize: summarizeChecks },
  };
}

function register(ctx) {
  assertPepperKept({ hasVouchers: () => tableHasRows(ctx.db) });
  ctx.migrations([...MIGRATIONS]);
  ctx.settings.declare(settings.DECLARED);
  ctx.pushChannel({ key: PUSH_CHANNEL, label: 'Bons cadeaux : vérifications suspendues' });

  const encryption = sdk.coreModule('encryption');
  const settingsModel = () => sdk.coreModule('settingsModel');
  const siteOrigin = () => settingsModel().publicSiteOrigin();
  const pageUrl = () => String(ctx.settings.get('pageUrl') || '').trim() || siteOrigin();

  // Built on first use: the tables exist only once the plugin is installed, and a suite registers it with no database.
  let built = null;
  const buildApi = () => buildGiftVouchersApi({
    db: ctx.db,
    pepper: once(() => sdk.secrets.getOrCreate(PEPPER_NAME, 32)),
    encrypt: encryption.encrypt,
    decrypt: encryption.safeDecrypt,
    settingsStore: () => ctx.settings,
    quote: (stay) => {
      const input = {
        propertyId: stay.propertyId, startDate: stay.startDate, endDate: stay.endDate, adults: stay.adults, children: 0, teens: 0, babies: 0, babyBeds: 0, options: [], resources: [],
      };
      return sdk.coreModule('directQuote').buildEngineQuote(input);
    },
    pow: sdk.proofOfWork,
    powSecret: () => sdk.secrets.getOrCreate(sdk.proofOfWork.SECRET_NAME, 32),
    guard: sdk.middleware.publicApi,
    sendMail: (mail) => ctx.mail.send(mail),
    paymentMethods: () => sdk.coreModule('paymentTenders').METHODS.map(({ value, label }) => ({ value, label })),
    payments: {
      saleLink: (sale, options) => sdk.core.payments.saleLink({ source: SOURCE, ...sale }, options),
      refreshLink: (linkId) => sdk.core.payments.refreshBasketLink(linkId),
    },
    siteOrigin,
    stayOf: (id) => sdk.coreModule('reservationsModel').getRow(Number(id)) || null,
    isConverted: (devisId) => {
      const quote = sdk.coreModule('reservationsModel').getRow(Number(devisId));
      return Boolean(quote && (quote.kind !== 'devis' || quote.convertedReservationId));
    },
    collectedCents: (stay) => Math.round(sdk.coreModule('reservationSettlement').comptaCollected(stay) * 100),
    receipts: {
      receivedOn: (stayId) => sdk.coreModule('prepaidReceipts').receivedOn(ctx.db, stayId, PREPAID_SOURCE),
      owedCentsOn: (stayId) => sdk.coreModule('prepaidReceipts').owedCentsOn(ctx.db, stayId),
      recordOnStay: (args) => sdk.coreModule('prepaidReceipts').recordOnStay({ database: ctx.db, ...args }),
      undoOnStay: (args) => sdk.coreModule('prepaidReceipts').undoOnStay({ database: ctx.db, ...args }),
    },
    limiters: {
      payStart: sdk.coreModule('rateLimiters').paymentStartLimiter,
      status: sdk.coreModule('rateLimiters').paymentStatusLimiter,
    },
    onlineSaleAvailable: () => Boolean(sdk.coreModule('paymentProviders').active()),
    companyName: () => String(settingsModel().read().companyName || '').trim() || 'GuestFlow',
    pageUrl,
    bookingUrl: () => String(ctx.settings.get('bookingUrl') || '').trim() || siteOrigin(),
    termsVersionId: () => {
      const current = sdk.coreModule('termsModel').getCurrent();
      return current ? current.id : null;
    },
    onCheckLimitsTrip: ({ failed }) => {
      ctx.log.warn(`public code checks paused: ${failed} failed checks in an hour`);
      Promise.resolve().then(() => sdk.coreModule('pushService').sendToPref(PUSH_CHANNEL, {
        title: PAUSED_ITEM.title, body: PAUSED_ITEM.detail, url: '/bons-cadeaux',
      })).catch(() => {});
    },
  });

  const api = () => {
    if (!built) built = buildApi();
    return built;
  };

  ctx.setupStatus(() => (pageUrl() ? null : 'adresse de la page du bon à renseigner'));
  ctx.mount('/public/v1/gift-vouchers', (req, res, next) => api().publicRouter(req, res, next), { public: true });
  ctx.mount('/api/gift-vouchers', (req, res, next) => api().adminRouter(req, res, next));
  ctx.attention({
    key: 'gift-voucher-checks',
    rank: 30,
    handler: (req, res) => api().attention.handler(req, res),
    summarize: (payload) => summarizeChecks(payload),
  });
  ctx.paymentBasket({ source: SOURCE, paid: (event) => api().orderPaid(event) });
  // Rules 43-44 — each voucher sold is a sale of the books, HT + VAT at its frozen rate.
  ctx.standaloneSales((window) => (tableHasRows(ctx.db) ? api().salesBetween(window) : []));
  // Rules 36-39 — the voucher as a means of payment on a booking: the core holds, prices and settles through these four calls.
  ctx.prepaid({
    source: PREPAID_SOURCE,
    label: PREPAID_LABEL,
    apply: (args) => api().redemption.apply(args),
    held: (devisId) => api().redemption.held(devisId),
    settle: (args) => api().redemption.settle(args),
    release: (args) => api().redemption.release(args),
  });
  ctx.events.on('pricing.changed', () => { if (built) built.offerService.invalidateIdeas(); });

  ctx.jobs.every({
    name: 'pending-orders-purge', intervalMs: DAY_MS, bootDelayMs: 300 * 1000, run: async () => { api().purgeStaleOrders(); },
  });
  ctx.jobs.every({
    name: 'receipts-retry', intervalMs: RECEIPT_RETRY_MS, bootDelayMs: 240 * 1000, run: async () => { await api().retryReceipts(); },
  });
  ctx.jobs.every({
    name: 'holds-release', intervalMs: HOLD_CHECK_MS, bootDelayMs: 270 * 1000, run: async () => { api().releaseLapsedHolds(); },
  });
  ctx.jobs.every({
    name: 'checks-purge', intervalMs: DAY_MS, bootDelayMs: 330 * 1000, run: async () => { api().purgeOldChecks(); },
  });

  ctx.data({
    tables: [...TABLES],
    describe: (db) => {
      const vouchers = createVouchersModel(db);
      const count = vouchers.count();
      return count ? [{ label: count > 1 ? `${count} bons cadeaux` : '1 bon cadeau', count }] : [];
    },
    refuse: (db) => (createVouchersModel(db).withBalance() > 0 ? ERASE_REFUSAL : null),
    purge: (db) => {
      if (createVouchersModel(db).withBalance() > 0) throw new Error(ERASE_REFUSAL);
    },
  });
}

module.exports = {
  id, register, buildGiftVouchersApi, memorySettings, assertPepperKept, tableHasRows, PEPPER_NAME,
};
