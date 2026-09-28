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

module.exports = Object.freeze({
  core: require('./coreServices'),
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
