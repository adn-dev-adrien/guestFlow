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
