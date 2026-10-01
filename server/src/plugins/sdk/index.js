/**
 * What a plugin file may `require` from the core (specs/plugins-phase-1-sdk.md rules 3 and 11).
 *
 *   core    — the services of the running app (the same object as `ctx.core`).
 *   models  — core models bound to a GIVEN database, for plugin models that run on `ctx.db` in
 *             production and on an in-memory database in tests.
 *   pricing, calendar — pure core helpers a plugin computes with.
 *
 * Everything is resolved lazily: plugins load while the core is still booting.
 */

// specs/plugins-phase-2-hosts.md rule 2 — the core modules the plugins moved in phase 2 still call:
// the money they read or write stays in the core (the SAS commit, the journal's inputs, pricing), the
// plugin only calls it. One reviewed list, one line per module, each with the plugin that needs it.
// `coreModule(name)` refuses anything else, so a plugin cannot reach the core by a side door.
const CORE_MODULES = Object.freeze({
  database: '../../database', // every plugin model binds to the app's database in production
  settingsModel: '../../models/settingsModel', // core settings a plugin reads (company, VAT, fiscal year)
  // sas
  reservationsModel: '../../models/reservationsModel', // the SAS reads the stay and calls the core commit (its money)
  linenItemsModel: '../../models/linenItemsModel', // « Facturables » linen prices, read and edited by the SAS
  repairAmountsModel: '../../models/repairAmountsModel', // « Facturables » repair prices; the departure commit prices from them
  breakfastModel: '../../models/breakfastModel', // the breakfast page state of the arrival SAS
  optionsModel: '../../models/optionsModel', // the catalogue the arrival SAS may still sell
  resourceSchedulingModel: '../../models/resourceSchedulingModel', // the hourly-resource step (phase 0 switch until phase 3)
  sasOptionSale: '../../utils/sasOptionSale', // what the check-in may sell, priced by the core
  arrivalPaymentGroup: '../../utils/arrivalPaymentGroup', // the single arrival payment the commit recorded
  optionCategoriesMigration: '../../utils/optionCategoriesMigration', // CATERING_CATEGORY, the « Restauration » catalogue
  roles: '../../constants/roles', // isReceptionOnly — the reception role stays core (rule 13)
  sasEditWindow: '../../utils/sasEditWindow', // the reception's day window, shared with the fiche and the status toggle
  reservationSettlement: '../../utils/reservationSettlement', // what the stay still owes at the door
  platformNameFormat: '../../utils/platformNameFormat', // direct channel vs platform for the stay step
  receptionView: '../../utils/receptionView', // the reception's money-stripped reads and commits
  // website-booking — the public API prices, checks and records with the core's own models (rule 23)
  propertiesModel: '../../models/propertiesModel', // the catalogue the site lists
  resourcesModel: '../../models/resourcesModel', // resources offered and checked on a quote
  propertyOptionDefaultsModel: '../../models/propertyOptionDefaultsModel', // defaults merged into a quote
  propertyDefaultOptions: '../../utils/propertyDefaultOptions', // the merge of those defaults
  clientsModel: '../../models/clientsModel', // find or create the guest of a booking request
  devisModel: '../../models/devisModel', // a booking request creates a draft devis
  termsModel: '../../models/termsModel', // current CGV version, the acceptance record (rule 26)
  updateStateModel: '../../models/updateStateModel', // the WordPress plugin release the manifest serves
  neatSubscriptionsModel: '../../models/neatSubscriptionsModel', // Neat insurance pricing on a quote
  pricing: '../../utils/pricing', // the quote engine
  reservationHelpers: '../../utils/reservationHelpers', // today's date, as the engine reads it
  capacity: '../../utils/capacity', // guest capacity of a property
  blockedDates: '../../utils/blockedDates', // availability, shared with the public payment
  mealPortions: '../../utils/mealPortions', // per-person card options and their caps
  neatGuestPricing: '../../utils/neatGuestPricing', // the insurance price shown on a quote
  neatClient: '../../utils/neatClient', // the Neat quote call
  translationResolver: '../../utils/translationResolver', // the English catalogue
  optionVisibility: '../../utils/optionVisibility', // internal options never reach the site
  optionGrouping: '../../utils/optionGrouping', // options grouped by category
  publicLabels: '../../utils/publicLabels', // public wording, shared with the core meal portions
  publicDevisToken: '../../utils/publicDevisToken', // the capability token of a website devis
  publicPaymentMode: '../../utils/publicPaymentMode', // full or deposit, shared with the public payment
  attributionChannel: '../../utils/attributionChannel', // request origin, read by finance (rule 26)
  babyBedResource: '../../utils/babyBedResource', // the baby-bed flag of a public resource
  releaseClient: '../../utils/releaseClient', // the allowed download hosts of the plugin manifest
  notificationService: '../../utils/notificationService', // « Nouvelle demande de devis » (rule 26)
  publicHttp: '../../controllers/public/publicHttp', // the public envelope, shared with the public payment
  publicPaymentController: '../../controllers/public/publicPaymentController', // pay/status, the core's provider-neutral money path
  rateLimiters: '../../middleware/rateLimiters', // the booking-request and payment-status limiters
  enforceSubscription: '../../middleware/enforceSubscription', // closedWhenReadOnly on the only public write
  // accounting-export
  platformsModel: '../../models/platformsModel', // the journal's commission config; the account plan writes its two columns (rule 20)
  refundsModel: '../../models/refundsModel', // refunds by month, mirrored as avoirs in the journal
  cancellationCompensationsModel: '../../models/cancellationCompensationsModel', // compensations received by month, booked in the journal
  midStayExtras: '../../utils/midStayExtras', // the mid-stay share of a complement, kept out of its entry
  complementAllocation: '../../utils/complementAllocation', // the stored ventilation of an adjusted complement
  csv: '../../utils/csv', // the generic CSV writer the sales export serialises with
  settingsValidation: '../../utils/settingsValidation', // the VAT-rate validator of the account plan
  // online-payment — the provider hands the core what it reads; the core records it (phase 3a rule 4)
  paymentLinksModel: '../../models/paymentLinksModel', // the webhook finds its link by provider id
  paymentPollRunner: '../../utils/paymentPollRunner', // the paid effect and the poll pass, core money
  paymentEffectDeps: '../../utils/paymentEffectDeps', // confirmation email, conflict check, notifications
});

function coreModule(name) {
  const target = CORE_MODULES[name];
  if (!target) throw new Error(`[sdk] core module "${name}" is not exposed to plugins`);
  return require(target); // eslint-disable-line import/no-dynamic-require, global-require
}

module.exports = Object.freeze({
  core: require('./coreServices'),
  coreModule,
  CORE_MODULE_NAMES: Object.freeze(Object.keys(CORE_MODULES)),
  models: Object.freeze({
    properties: (db) => require('../../models/propertiesModel').buildModel(db),
    closures: (db) => require('../../models/establishmentClosuresModel').create(db),
    tariffJournal: (db) => require('../../models/tariffChangeJournalModel').createTariffChangeJournalModel(db),
  }),
  roles: Object.freeze({ ADMIN: require('../../constants/roles').ADMIN }),
  // The rate limit every /public/v1 tree carries.
  middleware: Object.freeze({
    get publicApiLimiter() { return require('../../middleware/rateLimiters').publicApiLimiter; },
  }),
  // Secrets the operator copies into another system live in server/.env.local, never in the database.
  secrets: Object.freeze({
    getOrCreate: (name, byteLength = 32) => require('../../utils/localEnv').getOrCreateSecret(name, byteLength),
  }),
  pricing: Object.freeze({
    normalizeProgressiveTiers: (...args) => require('../../utils/pricing').normalizeProgressiveTiers(...args),
  }),
  calendar: Object.freeze({
    frenchPublicHolidays: (...args) => require('../../utils/frenchHolidays').getFrenchPublicHolidays(...args),
  }),
});
