/**
 * Gift vouchers (specs/gift-vouchers.md). Owns `/public/v1/gift-vouchers/**`, `/api/gift-vouchers/**`, its four tables and
 * its settings. Nothing in the core behaves differently while it is absent (rule 1); a voucher is an amount in euros
 * whose balance is the sum of its ledger (rules 5, 11).
 */

const sdk = require('../sdk');
const { MIGRATIONS, TABLES } = require('./migrations');
const settings = require('./settings');
const rules = require('./voucherRules');
const createVouchersModel = require('./models/vouchersModel');
const createOrdersModel = require('./models/ordersModel');
const createMovementsModel = require('./models/movementsModel');
const createChecksModel = require('./models/checksModel');
const { createIssuance } = require('./issuance');
const { createIdeas } = require('./ideas');
const { createCheckLimits } = require('./rateLimiters');
const { createProof } = require('./proof');
const { renderVoucherPdf } = require('./voucherPdf');
const { buildAdminController } = require('./controllers/adminController');
const { buildPublicCheckController } = require('./controllers/publicCheckController');
const { buildPublicOrdersController } = require('./controllers/publicOrdersController');
const { buildAdminRouter } = require('./routes/admin');
const { buildPublicRouter } = require('./routes/public');

const id = 'gift-vouchers';
const PEPPER_NAME = 'GIFT_VOUCHER_PEPPER';
const PUSH_CHANNEL = 'gift-voucher-checks';
const DAY_MS = 24 * 60 * 60 * 1000;
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

function buildGiftVouchersApi({
  db, pepper, encrypt, decrypt, settingsStore = () => memorySettings(), now = () => new Date(), quote, pow, powSecret, guard,
  sendMail, paymentMethods, companyName, pageUrl, bookingUrl, termsVersionId = () => null, onlineSaleAvailable = () => false,
  randomBytes, onCheckLimitsTrip = () => {}, transaction = (fn) => db.transaction(fn)(),
}) {
  const get = (key) => settingsStore().get(key);
  const limits = () => settings.limitsOf(get);
  const vouchers = createVouchersModel(db);
  const orders = createOrdersModel(db, { now });
  const movements = createMovementsModel(db, { now });
  const checks = createChecksModel(db, { now });
  const issuance = createIssuance({
    db, vouchers, orders, movements, pepper, encrypt, now, randomBytes,
  });
  const checkLimits = createCheckLimits({ checks, now, onTrip: onCheckLimitsTrip });
  const ideas = createIdeas({
    ideas: () => settings.ideasOf(get), bounds: limits, quote, now, todayOf: rules.parisDate,
  });
  const respond = sdk.coreModule('publicHttp');
  const ipOf = (req) => pow.ipKeyOf(req.visitor && req.visitor.ip ? req.visitor.ip : req.ip) || 'unknown';

  const admin = buildAdminController({
    vouchers, orders, movements, issuance, transaction, limits, paymentMethods, decrypt, sendMail, renderPdf: renderVoucherPdf,
    settingsGet: get, brand: companyName, pageUrl, bookingUrl, now,
  });
  const check = buildPublicCheckController({
    vouchers, checks, limits: checkLimits, pepper, proof: createProof({ pow, secret: powSecret }), ipOf, now, respond,
  });
  const offer = buildPublicOrdersController({
    ideas, limits, termsVersionId, available: onlineSaleAvailable, respond,
  });

  return {
    adminRouter: buildAdminRouter({ admin }),
    publicRouter: buildPublicRouter({ guard, offer, check }),
    vouchers,
    orders,
    movements,
    checks,
    issuance,
    ideas,
    checkLimits,
    limits,
    purgeStaleOrders: () => orders.purgeStalePending(),
    purgeOldChecks: () => checks.purgeOld(),
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
    paymentMethods: () => sdk.coreModule('paymentTenders').METHODS.map((m) => m.value),
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
  ctx.events.on('pricing.changed', () => { if (built) built.ideas.invalidate(); });

  ctx.jobs.every({
    name: 'pending-orders-purge', intervalMs: DAY_MS, bootDelayMs: 300 * 1000, run: async () => { api().purgeStaleOrders(); },
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
