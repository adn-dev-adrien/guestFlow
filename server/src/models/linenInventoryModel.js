/**
 * linenInventoryModel — thin DB-access wrapper that gathers the inputs the pure
 * `utils/linenInventory.js` engine expects and delegates to it
 * (specs/linen-inventory-shortage-tracking.md §4.1).
 *
 * No business logic. Just SQL → engine call → return.
 *
 * Factory pattern (`buildModel(db)`) for unit-test isolation, identical to other models.
 */

const { simulateInventory, findHorizon } = require('../utils/linenInventory');

function buildModel(database, deps = {}) {
  const settingsModel = deps.settingsModel || require('./settingsModel');
  // specs/skip-laundry-trip.md §4.1 — the skips model is the single source of truth for
  // which dates the operator marked as not-made. Injected via `deps` for tests; defaults
  // to a fresh factory instance bound to the same `database` so unit tests against an
  // in-memory schema see THEIR skips, not the production model's (which would be bound to
  // the global `../database` module at import time).
  const laundryTripSkipsModel = deps.laundryTripSkipsModel
    || require('./laundryTripSkipsModel').create(database);
  // specs/manual-laundry-additions.md §4.1 — per-trip manual linen, folded into the simulation as
  // extra linen washed on each trip. Injected via `deps` for tests; defaults to a fresh factory bound
  // to THIS database (same rationale as the skips model above).
  const laundryManualAdditionsModel = deps.laundryManualAdditionsModel
    || require('./laundryManualAdditionsModel').create(database);
  // specs/laundry-extra-trip.md §4.1 — extra laundry trips on a free date. The table is brand-new, so
  // the guard wraps the MODEL CONSTRUCTION (its prepared statements would throw on a schema without
  // the table): minimal test schemas and partially-migrated DBs degrade to "no extra trips".
  const HAS_EXTRA_TRIPS_TABLE = (() => {
    try { database.prepare('SELECT 1 FROM laundry_extra_trips LIMIT 1').get(); return true; }
    catch { return false; }
  })();
  const laundryExtraTripsModel = deps.laundryExtraTripsModel
    || (HAS_EXTRA_TRIPS_TABLE ? require('./laundryExtraTripsModel').create(database) : { listAll: () => [] });

  // Bath mat (specs/laundry-bath-mat.md) is a brand-new column/table; guard so minimal test
  // schemas (and partially-migrated DBs) degrade to "no bath mats" instead of throwing at build.
  const HAS_BATH_MAT_COL = (() => {
    try { return database.prepare('PRAGMA table_info(options)').all().some((c) => c.name === 'countsAsBathMat'); }
    catch { return false; }
  })();
  const HAS_BATH_MAT_TABLE = (() => {
    try { database.prepare('SELECT 1 FROM property_option_bath_mats LIMIT 1').get(); return true; }
    catch { return false; }
  })();
  const BATH_MAT_OR = HAS_BATH_MAT_COL ? 'OR o.countsAsBathMat = 1 ' : '';
  // specs/laundry-counts-explicit-option-only.md §3.1 rule 5 — the engine needs `displayToClient` to
  // tell an internal option (property-default source) from a visible one (ticked-row source only).
  // A schema without the column reports every option as visible, i.e. explicit-row-only.
  const HAS_DISPLAY_TO_CLIENT = (() => {
    try { return database.prepare('PRAGMA table_info(options)').all().some((c) => c.name === 'displayToClient'); }
    catch { return false; }
  })();

  const fetchReservationsStmt = database.prepare(`
    SELECT id, kind, propertyId, startDate, endDate,
           singleBeds, doubleBeds, babyBeds,
           adults, teens, children, babies
      FROM reservations
     WHERE kind = 'reservation'
       AND endDate >= ?
  `);
  const fetchOptionsStmt = database.prepare(`
    SELECT id, countsAsBedLinen, countsAsBathroomLinen, ${HAS_BATH_MAT_COL ? 'countsAsBathMat' : '0 AS countsAsBathMat'},
           ${HAS_DISPLAY_TO_CLIENT ? 'displayToClient' : '1 AS displayToClient'},
           linenIncludesSingle, linenIncludesDouble, linenIncludesBaby,
           towelLargePerPerson, towelMediumPerPerson, towelSmallPerPerson
      FROM options
     WHERE countsAsBedLinen = 1 OR countsAsBathroomLinen = 1 ${HAS_BATH_MAT_COL ? 'OR countsAsBathMat = 1' : ''}
  `);
  const fetchReservationOptionsStmt = database.prepare(`
    SELECT ro.reservationId, ro.optionId, ro.quantity
      FROM reservation_options ro
      JOIN options o ON o.id = ro.optionId
     WHERE o.countsAsBedLinen = 1 OR o.countsAsBathroomLinen = 1 ${BATH_MAT_OR}
  `);
  const fetchPropertyDefaultsStmt = database.prepare(`
    SELECT pod.propertyId, pod.optionId
      FROM property_option_defaults pod
      JOIN options o ON o.id = pod.optionId
     WHERE o.countsAsBedLinen = 1 OR o.countsAsBathroomLinen = 1 ${BATH_MAT_OR}
  `);
  // Per-property bath-mat quantity for the "Tapis de bain" option(s). Built only when the table
  // exists; an absent property → quantity 0 (handled by the engine via the default 0).
  const fetchBathMatQtyStmt = HAS_BATH_MAT_TABLE ? database.prepare(`
    SELECT pobm.propertyId, pobm.quantity
      FROM property_option_bath_mats pobm
      JOIN options o ON o.id = pobm.optionId
     WHERE o.countsAsBathMat = 1
  `) : null;

  /**
   * Run the simulation from `today` to the last known reservation's endDate.
   *
   * @returns {object|null} `{ horizon, days, shortagesByType }` or null when there are no
   *   reservations beyond `today` (no horizon to project against).
   */
  function simulate({ today = new Date().toISOString().slice(0, 10) } = {}) {
    const settingsRow = settingsModel.read();
    const stock = {
      single: Number(settingsRow.bedLinenStockSingle || 0),
      double: Number(settingsRow.bedLinenStockDouble || 0),
      baby:   Number(settingsRow.bedLinenStockBaby   || 0),
      large:  Number(settingsRow.towelStockLarge     || 0),
      medium: Number(settingsRow.towelStockMedium    || 0),
      small:  Number(settingsRow.towelStockSmall     || 0),
      bathMat: Number(settingsRow.towelStockBathMat  || 0),
    };
    const laundryWeekday = Number(settingsRow.laundryWeekday == null ? 2 : settingsRow.laundryWeekday);

    // We pull reservations whose endDate >= today − 35 so the initial state can be computed: the
    // seed batch of the last regular trip reaches back a week before that trip (up to 13 days before
    // today), the dirty window widens across skipped trips (up to 4 weeks), and the extra trips
    // between the last regular trip and today are replayed on their own windows
    // (specs/laundry-extra-trip.md §3.3 rule 14). The former 7-day fetch silently treated linen
    // from stays ending 8-13 days ago as clean for the week after a trip.
    const lookbackFrom = (() => {
      const d = new Date(`${today}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - 35);
      return d.toISOString().slice(0, 10);
    })();
    const reservations = fetchReservationsStmt.all(lookbackFrom);
    const horizon = findHorizon(reservations);
    if (!horizon || horizon < today) return null;

    const options = fetchOptionsStmt.all();
    const reservationOptions = fetchReservationOptionsStmt.all();
    const propertyDefaults = fetchPropertyDefaultsStmt.all();
    const bathMatByProperty = new Map();
    if (fetchBathMatQtyStmt) {
      for (const row of fetchBathMatQtyStmt.all()) {
        bathMatByProperty.set(Number(row.propertyId), Number(row.quantity || 0));
      }
    }
    const skippedDates = new Set(laundryTripSkipsModel.listAll());

    // Map the per-trip manual additions (stored with singleBeds/…/smallTowels keys) onto the engine's
    // byType keys (single/…/small) so simulateInventory washes them like reservation linen.
    const manualAdditionsByDate = new Map();
    for (const [date, c] of Object.entries(laundryManualAdditionsModel.listAll())) {
      manualAdditionsByDate.set(date, {
        single: c.singleBeds, double: c.doubleBeds, baby: c.babyBeds,
        large: c.largeTowels, medium: c.mediumTowels, small: c.smallTowels,
      });
    }

    // Extra trips (stored with singleBeds/…/bathMats keys) mapped onto the engine's byType keys.
    const extraTripsByDate = new Map();
    for (const trip of laundryExtraTripsModel.listAll()) {
      const c = trip.pickUp || {};
      extraTripsByDate.set(trip.date, {
        pickUpAll: trip.pickUpAll !== false,
        pickUp: {
          single: c.singleBeds, double: c.doubleBeds, baby: c.babyBeds,
          large: c.largeTowels, medium: c.mediumTowels, small: c.smallTowels, bathMat: c.bathMats,
        },
      });
    }

    const result = simulateInventory({
      stock, reservations, options, reservationOptions, propertyDefaults,
      laundryWeekday, from: today, to: horizon, skippedDates, manualAdditionsByDate,
      bathMatByProperty, extraTripsByDate,
    });

    return { horizon, ...result };
  }

  return { simulate };
}

const db = require('../database');
const defaultModel = buildModel(db);
defaultModel.buildModel = buildModel;

module.exports = defaultModel;
