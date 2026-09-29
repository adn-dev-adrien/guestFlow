/**
 * Vigilance Météo-France (specs/checkin-weather-alerts.md; module per specs/plugins-phase-1-sdk.md).
 * The orange/red alerts overlapping a stay, read by the arrival SAS. No job: fetched on demand and
 * cached 30 minutes per département.
 */

const { createController } = require('./controller');
const { buildModel: buildCacheModel } = require('./cacheModel');

const id = 'weather-alerts';

function register(ctx) {
  ctx.migrations([{
    name: 'cache_table_v1',
    up: (db) => db.exec(`
      CREATE TABLE IF NOT EXISTS weather_vigilance_cache (
        departmentCode TEXT PRIMARY KEY,
        payload        TEXT NOT NULL,
        fetchedAt      TEXT NOT NULL
      );
    `),
  }]);

  ctx.settings.declare([{ key: 'apiKey', secret: true }]);

  let cache = null;
  const controller = createController({
    getReservation: (reservationId) => ctx.core.reservations.getByIdWithDetails(reservationId),
    companyAddress: () => ctx.core.settings.companyAddress(),
    apiKey: () => ctx.settings.get('apiKey'),
    cache: () => {
      if (!cache) cache = buildCacheModel(ctx.db);
      return cache;
    },
  });

  ctx.route('get', '/api/reservations/:id/weather-alerts', controller.getReservationAlerts);
  ctx.reception([{ method: 'GET', re: /^\/reservations\/\d+\/weather-alerts$/ }]);

  ctx.data({
    tables: ['weather_vigilance_cache'],
    purge: () => { cache = null; },
    describe: (db) => {
      const n = db.prepare('SELECT COUNT(*) AS n FROM weather_vigilance_cache').get().n;
      const lines = [];
      if (n > 0) lines.push({ label: n > 1 ? `${n} départements en cache` : '1 département en cache', count: n });
      if (ctx.settings.raw('apiKey')) lines.push({ label: 'la clé Météo-France', count: 1 });
      return lines;
    },
  });
}

module.exports = { id, register };
