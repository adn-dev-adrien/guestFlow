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
  sasCommitHooks: '../../utils/sasCommitHooks', // the steps of other plugins, around the core commit (phase 3c rule 6)
  sasOptionSale: '../../utils/sasOptionSale', // what the check-in may sell, priced by the core
  arrivalSasPlan: '../../utils/arrivalSasPlan', // the arithmetic of the arrival plan, shared by preview and commit
  departureSasPlan: '../../utils/departureSasPlan', // the arithmetic of the departure plan, shared by preview and commit
  arrivalPaymentGroup: '../../utils/arrivalPaymentGroup', // the single arrival payment the commit recorded
  optionCategoriesMigration: '../../utils/optionCategoriesMigration', // CATERING_CATEGORY, the « Restauration » catalogue
  roles: '../../constants/roles', // isReceptionOnly — the reception role stays core (rule 13)
  sasEditWindow: '../../utils/sasEditWindow', // the reception's day window, shared with the fiche and the status toggle
  reservationSettlement: '../../utils/reservationSettlement', // what the stay still owes at the door
  platformNameFormat: '../../utils/platformNameFormat', // direct channel vs platform for the stay step
  receptionView: '../../utils/receptionView', // the reception's money-stripped reads and commits
  planningDateRange: '../../utils/planningDateRange', // linen, hourly-resources — the span cap of the planning reads (DATA-1)
  // website-booking — the public API prices, checks and records with the core's own models (rule 23)
  propertiesModel: '../../models/propertiesModel', // the catalogue the site lists
  resourcesModel: '../../models/resourcesModel', // resources offered and checked on a quote
  propertyOptionDefaultsModel: '../../models/propertyOptionDefaultsModel', // defaults merged into a quote
  propertyDefaultOptions: '../../utils/propertyDefaultOptions', // the merge of those defaults
  clientsModel: '../../models/clientsModel', // find or create the guest of a booking request
  devisModel: '../../models/devisModel', // a booking request creates a draft devis
  termsModel: '../../models/termsModel', // current CGV version, the acceptance record (rule 26)
  updateStateModel: '../../models/updateStateModel', // the WordPress plugin release the manifest serves
  pricing: '../../utils/pricing', // the quote engine
  directQuote: '../../utils/directQuote', // the website's quote (default options merged), also priced by google-vacation-rentals (SDK 2.4.0)
  reservationHelpers: '../../utils/reservationHelpers', // today's date, as the engine reads it
  capacity: '../../utils/capacity', // guest capacity of a property
  devisHelpers: '../../utils/devisHelpers', // the extra-guest row of a quote, read from its pricing
  blockedDates: '../../utils/blockedDates', // availability, shared with the public payment
  changeover: '../../utils/changeover', // arrival/departure weekdays, for the site's next bookable night (SDK 1.3.0)
  mealPortions: '../../utils/mealPortions', // per-person card options and their caps
  quotePostProcessors: '../../utils/quotePostProcessors', // the insurance price a plugin sets on a quote (phase 3b rule 2)
  insuranceOffer: '../../utils/insuranceOffer', // no insurance on the site while no plugin offers it (phase 3b rule 6)
  resourceOffer: '../../utils/resourceOffer', // nothing sold by the hour on the site while no plugin offers it (phase 3c rule 18)
  translationResolver: '../../utils/translationResolver', // the English catalogue
  optionVisibility: '../../utils/optionVisibility', // internal options never reach the site
  optionGrouping: '../../utils/optionGrouping', // options grouped by category
  publicLabels: '../../utils/publicLabels', // public wording, shared with the core meal portions
  publicDevisToken: '../../utils/publicDevisToken', // the capability token of a website devis
  publicPaymentMode: '../../utils/publicPaymentMode', // full or deposit, shared with the public payment
  paymentProviders: '../../utils/paymentProviders', // whether the site can take a payment now (public-online-payment rule 12)
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
  vatRegimeModel: '../../models/vatRegimeModel', // the VAT rate and regime of each sale: the journal reads them per reservation (vat-optional-mode rule 8, SDK 2.8.0)
  // online-payment — the provider hands the core what it reads; the core records it (phase 3a rule 4)
  paymentLinksModel: '../../models/paymentLinksModel', // the webhook finds its link by provider id
  paymentPollRunner: '../../utils/paymentPollRunner', // the paid effect and the poll pass, core money
  paymentEffectDeps: '../../utils/paymentEffectDeps', // confirmation email, conflict check, notifications
  qonto: '../../utils/qonto', // the Qonto library, shared with the control plane (phase 3a rule 22)
  // online-payment, bank reconciliation — what the fiche expects, and the fiche's own payment mark (rule 34)
  reservationLedger: '../../utils/reservationLedger', // the payments ledger the expected receipts are read from (rule 10)
  reservationPaymentMark: '../../utils/reservationPaymentMark', // « Marquer perçu » without a request, same guards
  platformDisplay: '../../utils/platformDisplay', // the platform's display name on a reconciliation line
  // accounting-export — the tourist tax shared over the installments of a plan (direct-installments rule 39)
  installmentPlan: '../../utils/installmentPlan', // pure plan rules, shared with the books
  // online-payment, bank reconciliation — each installment of a plan is a receipt of its own (direct-installments rule 38)
  installmentsModel: '../../models/installmentsModel', // the plan's rows, read through the core model
  // accounting-export — a platform penalty is an entry of its own, dated on the penalty (reconciliation-assisted-matching rule 28)
  platformPenaltiesModel: '../../models/platformPenaltiesModel', // the penalty lines of a stay
  // neat — the stay it subscribes is priced by the core engine; failures reach the admins by push (phase 3b rule 7)
  reservationEngineInput: '../../utils/reservationEngineInput', // the engine input of a stored stay
  pushService: '../../utils/pushService', // « Souscriptions Neat » push
  // hourly-resources — the resources, the stays and their sessions stay core tables (phase 3c rule 16)
  dateFr: '../../utils/dateFr', // the planning cards' and the occupancy strip's French times
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
    getOrCreate: (name, byteLength = 32, options) => require('../../utils/localEnv').getOrCreateSecret(name, byteLength, options),
    // A new value for a secret another system holds a copy of (specs/plugins-phase-2-hosts.md rule 31).
    // Read it with getOrCreate(name, n, { rotatable: true }) so the file wins over a stale inherited copy.
    rotate: (name, byteLength = 32) => require('../../utils/localEnv').rotateSecret(name, byteLength),
  }),
  pricing: Object.freeze({
    normalizeProgressiveTiers: (...args) => require('../../utils/pricing').normalizeProgressiveTiers(...args),
  }),
  calendar: Object.freeze({
    frenchPublicHolidays: (...args) => require('../../utils/frenchHolidays').getFrenchPublicHolidays(...args),
  }),
  // The version of the running plugin (audit r3, N-0): its manifest sits next to `server/` in a package and
  // next to `index.js` in the source tree; `dir` is the plugin's `__dirname`.
  manifestVersion: (dir) => {
    const fs = require('fs');
    const path = require('path');
    const at = [path.join(dir, 'manifest.json'), path.join(dir, '..', 'manifest.json')].find((f) => fs.existsSync(f));
    return JSON.parse(fs.readFileSync(at, 'utf8')).version;
  },
  // Read-only IMAP for the plugins that read booking mails (specs/airbnb-mail-intake.md rule 4).
  mailbox: Object.freeze({
    readMailsFrom: (...args) => require('./mailboxReader').readMailsFrom(...args),
    testConnection: (...args) => require('./mailboxReader').testConnection(...args),
    imapHostFor: (...args) => require('./mailboxReader').imapHostFor(...args),
    resolveImapHost: (...args) => require('./mailboxReader').resolveImapHost(...args),
  }),
});
