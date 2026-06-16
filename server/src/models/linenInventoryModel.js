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

  const fetchReservationsStmt = database.prepare(`
    SELECT id, kind, propertyId, startDate, endDate,
           singleBeds, doubleBeds, babyBeds,
           adults, teens, children, babies
      FROM reservations
     WHERE kind = 'reservation'
       AND endDate >= ?
  `);
  const fetchOptionsStmt = database.prepare(`
    SELECT id, countsAsBedLinen, countsAsBathroomLinen,
           linenIncludesSingle, linenIncludesDouble, linenIncludesBaby,
           towelLargePerPerson, towelMediumPerPerson, towelSmallPerPerson
      FROM options
     WHERE countsAsBedLinen = 1 OR countsAsBathroomLinen = 1
  `);
  const fetchReservationOptionsStmt = database.prepare(`
    SELECT ro.reservationId, ro.optionId, ro.quantity
      FROM reservation_options ro
      JOIN options o ON o.id = ro.optionId
     WHERE o.countsAsBedLinen = 1 OR o.countsAsBathroomLinen = 1
  `);
  const fetchPropertyDefaultsStmt = database.prepare(`
    SELECT pod.propertyId, pod.optionId
      FROM property_option_defaults pod
      JOIN options o ON o.id = pod.optionId
     WHERE o.countsAsBedLinen = 1 OR o.countsAsBathroomLinen = 1
  `);

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
    };
    const laundryWeekday = Number(settingsRow.laundryWeekday == null ? 2 : settingsRow.laundryWeekday);

    // We pull reservations whose endDate >= today − 7 so the initial atLaundry state can be
    // computed (it looks back up to the previous laundry day, which is ≤ 7 days before today).
    const lookbackFrom = (() => {
      const d = new Date(`${today}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - 7);
      return d.toISOString().slice(0, 10);
    })();
    const reservations = fetchReservationsStmt.all(lookbackFrom);
    const horizon = findHorizon(reservations);
    if (!horizon || horizon < today) return null;

    const options = fetchOptionsStmt.all();
    const reservationOptions = fetchReservationOptionsStmt.all();
    const propertyDefaults = fetchPropertyDefaultsStmt.all();
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

    const result = simulateInventory({
      stock, reservations, options, reservationOptions, propertyDefaults,
      laundryWeekday, from: today, to: horizon, skippedDates, manualAdditionsByDate,
    });

    return { horizon, ...result };
  }

  return { simulate };
}

const db = require('../database');
const defaultModel = buildModel(db);
defaultModel.buildModel = buildModel;

module.exports = defaultModel;
