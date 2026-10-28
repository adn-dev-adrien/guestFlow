/**
 * Linge et blanchisserie (module per specs/plugins-phase-2-hosts.md §3.D). The weekly laundry trip,
 * its skips, manual lines and extra trips, the linen stock and its shortage projection.
 *
 * What is sold and booked stays core (rule 16): the linen options and their flags, the bath mats per
 * property, the beds of each stay. The plugin reads those core tables; it writes only its own.
 */

const { buildModel: buildLaundryModel } = require('./laundryModel');
const { buildModel: buildLinenInventoryModel } = require('./linenInventoryModel');
const skipsModel = require('./skipsModel');
const laundryScheduleModel = require('./laundryScheduleModel');
const manualAdditionsModel = require('./manualAdditionsModel');
const extraTripsModel = require('./extraTripsModel');
const reservationNamesModel = require('./reservationNamesModel');
const skipsController = require('./skipsController');
const laundryScheduleController = require('./laundryScheduleController');
const manualAdditionsController = require('./manualAdditionsController');
const extraTripsController = require('./extraTripsController');
const { buildController: buildPlanningController } = require('./planningController');
const { buildController: buildShortageController } = require('./shortageController');
const { buildRouter } = require('./routes');
const { DECLARED, STOCK_KEYS, createLinenSettings } = require('./settings');
const { MIGRATIONS } = require('./migrations');
const sdk = require('../sdk');

const id = 'linen';

const plural = (n, one, many) => (n > 1 ? `${n} ${many}` : `1 ${one}`);
const countRows = (db, table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

function register(ctx) {
  ctx.migrations(MIGRATIONS);
  ctx.settings.declare(DECLARED);
  const settings = createLinenSettings(ctx.settings);

  // Built on first use: the tables exist only once the plugin is installed, and a purge drops them.
  let built = null;
  const parts = () => {
    if (built) return built;
    const db = ctx.db;
    const skips = skipsModel.create(db);
    const manual = manualAdditionsModel.create(db);
    const extra = extraTripsModel.create(db);
    const schedule = laundryScheduleModel.create(db);
    const laundry = buildLaundryModel(db);
    const inventory = buildLinenInventoryModel(db, {
      settingsModel: settings,
      laundryScheduleModel: schedule,
      laundryTripSkipsModel: skips,
      laundryManualAdditionsModel: manual,
      laundryExtraTripsModel: extra,
    });
    built = {
      schedule: laundryScheduleController.create({ scheduleModel: schedule, today: () => sdk.coreModule('reservationHelpers').getTodayIsoDate() }),
      skips: skipsController.create(skips),
      additions: manualAdditionsController.create(manual),
      extraTrips: extraTripsController.create({
        extraTripsModel: extra, manualAdditionsModel: manual, scheduleModel: schedule, laundryModel: laundry, skipsModel: skips,
      }),
      planning: buildPlanningController({
        laundryModel: laundry,
        settingsModel: settings,
        linenInventoryModel: inventory,
        laundryScheduleModel: schedule,
        laundryTripSkipsModel: skips,
        laundryManualAdditionsModel: manual,
        laundryExtraTripsModel: extra,
      }),
      shortage: buildShortageController({ linenInventoryModel: inventory, reservationsModel: reservationNamesModel.create(db) }),
    };
    return built;
  };
  const handler = (group, method) => (req, res, next) => parts()[group][method](req, res, next);

  ctx.mount('/api/laundry', buildRouter({
    schedule: { get: handler('schedule', 'get'), set: handler('schedule', 'set'), preview: handler('schedule', 'preview') },
    skips: { listSkips: handler('skips', 'listSkips'), addSkip: handler('skips', 'addSkip'), removeSkip: handler('skips', 'removeSkip') },
    additions: { listAdditions: handler('additions', 'listAdditions'), setAddition: handler('additions', 'setAddition') },
    extraTrips: {
      list: handler('extraTrips', 'list'),
      preview: handler('extraTrips', 'preview'),
      set: handler('extraTrips', 'set'),
      remove: handler('extraTrips', 'remove'),
    },
  }));
  // Rule 4 — under the core /api/planning prefix, at their URLs.
  ctx.route('get', '/api/planning/laundry', handler('planning', 'laundrySummary'));
  ctx.route('get', '/api/planning/linen-inventory', handler('planning', 'linenInventory'));
  // Gap 1 — the shortage alert answered while the plugin was off.
  ctx.route('get', '/api/dashboard/linen-shortage', handler('shortage', 'linenShortage'));
  ctx.attention({ key: 'linen-shortage', rank: 30, handler: handler('shortage', 'linenShortage'), summarize: require('./attention').summarize });

  // The reception runs the laundry from the planning; extra trips stay admin-only to write
  // (specs/laundry-extra-trip.md §3.4 rule 16). The planning reads are core entries.
  ctx.reception([
    { method: 'GET', re: /^\/laundry(\/|$)/ },
    { method: 'POST', re: /^\/laundry\/skips$/ },
    { method: 'DELETE', re: /^\/laundry\/skips\// },
    { method: 'PUT', re: /^\/laundry\/manual-additions\// },
  ]);

  // Rule 18 — the laundry's own records and the eight settings; every option, price, booked linen
  // line and bed stays (they are core). The tables and settings go through the generic purge.
  ctx.data({
    tables: ['laundry_trip_skips', 'laundry_trip_manual_additions', 'laundry_extra_trips', 'laundry_schedule_versions'],
    describe: (db) => {
      const lines = [];
      const skipped = countRows(db, 'laundry_trip_skips');
      if (skipped > 0) lines.push({ label: plural(skipped, 'tournée sautée', 'tournées sautées'), count: skipped });
      const additions = countRows(db, 'laundry_trip_manual_additions');
      if (additions > 0) lines.push({ label: plural(additions, 'ajout manuel', 'ajouts manuels'), count: additions });
      const extra = countRows(db, 'laundry_extra_trips');
      if (extra > 0) lines.push({ label: plural(extra, 'tournée supplémentaire', 'tournées supplémentaires'), count: extra });
      const stored = db.prepare(`SELECT COUNT(*) AS n FROM plugin_settings WHERE plugin_id = ? AND key IN (${STOCK_KEYS.map(() => '?').join(', ')})`)
        .get(id, ...STOCK_KEYS).n;
      if (stored > 0) lines.push({ label: 'le stock de linge', count: stored });
      const versions = countRows(db, 'laundry_schedule_versions');
      if (versions > 0) lines.push({ label: 'le rythme de blanchisserie', count: versions });
      return lines;
    },
    purge: () => { built = null; },
  });
}

module.exports = { id, register };
