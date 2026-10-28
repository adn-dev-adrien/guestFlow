/**
 * Planning endpoint of the laundry (specs/weekly-bed-linen-tracking.md, specs/linen-laundry-days.md,
 * specs/linen-inventory-shortage-tracking.md), served at its core URL under /api/planning by the
 * `linen` plugin (specs/plugins-phase-2-hosts.md rule 4).
 *
 * `settingsModel.read()` returns the linen settings (`settings.js`), shaped like the former
 * app_settings row.
 */

const sdk = require('../sdk');
const { createTripLedger, makeBlockBuilders, BLOCK_KEYS } = require('./laundryTripLedger');
const { createSchedule } = require('./laundrySchedule');

function buildController({
  laundryModel: injectedLaundryModel,
  settingsModel: injectedSettingsModel,
  linenInventoryModel: injectedLinenInventoryModel,
  laundryScheduleModel: injectedLaundryScheduleModel,
  laundryTripSkipsModel: injectedLaundryTripSkipsModel,
  laundryManualAdditionsModel: injectedLaundryManualAdditionsModel,
  laundryExtraTripsModel: injectedLaundryExtraTripsModel,
  today = () => sdk.coreModule('reservationHelpers').getTodayIsoDate(),
}) {
  // « Disponible après ce dépôt » (specs/linen-inventory-shortage-tracking.md §3.5): the clean stock at
  // the end of each laundry day, for the TRACKED types only (stock > 0) — an untracked type with demand
  // (bath mats at stock 0) would surface a misleading negative figure. From today to the horizon;
  // nothing is projected for the past (specs/linen-laundry-days.md rule 13).
  const inventoryByDate = (from, to, schedule) => {
    const now = today();
    if (to < now) return {};
    const result = injectedLinenInventoryModel.simulate({ today: now });
    if (!result) return {};
    const row = injectedSettingsModel.read();
    const stock = {
      single: row.bedLinenStockSingle, double: row.bedLinenStockDouble, baby: row.bedLinenStockBaby,
      large: row.towelStockLarge, medium: row.towelStockMedium, small: row.towelStockSmall,
      bathMat: row.towelStockBathMat,
    };
    const tracked = Object.keys(stock).filter((t) => Number(stock[t] || 0) > 0);
    const byDate = {};
    for (const day of result.days) {
      if (day.date < from || day.date > to) continue;
      if (!day.isTripDay && !schedule.isRegularDay(day.date)) continue;
      byDate[day.date] = Object.fromEntries(tracked.map((t) => [t, day.clean[t]]));
    }
    return byDate;
  };

  // Bath mats only draw a card when they are tracked (stock > 0): a type at stock 0 is not tracked
  // (specs/laundry-bath-mat.md §3 rule 7), and a day with nothing but mats is not worth a card.
  const total = (side, matsTracked) => BLOCK_KEYS
    .filter((k) => k !== 'bathMats' || matsTracked)
    .reduce((sum, k) => sum + (Number(side[k]) || 0), 0);

  // specs/linen-laundry-days.md rule 13 — the server decides which dates carry a card: an extra trip
  // (the operator's own decision), a skipped trip (so it can be reverted), a day with linen on either
  // side, a stay declaring linen without a quantity yet, or batches still at the laundry.
  const isDrawn = (entry, isSkipped, matsTracked) => entry.kind === 'extra'
    || isSkipped
    || total(entry.dropOff, matsTracked) + total(entry.pickUp, matsTracked) > 0
    || entry.dropOff.incomplete.length > 0
    || entry.stillAtLaundry.length > 0;

  return {
    /**
     * GET /api/planning/laundry/days?from=YYYY-MM-DD&to=YYYY-MM-DD
     *
     * The laundry cards of the Planning for a window, past or future (specs/linen-laundry-days.md §3.2
     * rule 13): `{ days: { 'YYYY-MM-DD': card } }` holding only the dates to draw. A card is ready to
     * render — kind, skip flag, drop-off (with the stays that still lack a quantity), pick-up (with the
     * drop dates it comes from), what still waits at the laundry, the projected stock after the drop,
     * the manual line and the extra trip of the date. Both bounds are required and bounded
     * (`checkPlanningRange`): the ledger runs ~10 queries per card and the reception can reach this.
     *
     * The ledger walks the trip sequence — every non-skipped regular laundry day of the schedule in
     * force on its date plus every active extra trip — so the cards and the stock projection tell the
     * same story (they share the batches logic).
     */
    laundryDays(req, res) {
      const from = req.query && req.query.from;
      const to = req.query && req.query.to;
      const rangeError = sdk.coreModule('planningDateRange').checkPlanningRange(from, to);
      if (rangeError) return res.status(rangeError.status).json({ error: rangeError.error });

      const schedule = createSchedule(injectedLaundryScheduleModel.listAll());
      const skippedDates = new Set(injectedLaundryTripSkipsModel.listAll());
      const extraTrips = injectedLaundryExtraTripsModel.listAll();
      const manualLines = injectedLaundryManualAdditionsModel.listAll();
      const ledger = createTripLedger({
        schedule,
        skippedDates,
        extraTrips,
        ...makeBlockBuilders({
          laundryModel: injectedLaundryModel,
          laundryManualAdditionsModel: injectedLaundryManualAdditionsModel,
        }),
      });
      const tripDates = Array.from(new Set([
        ...schedule.regularDaysInRange(from, to),
        ...ledger.extraDates.filter((d) => d >= from && d <= to),
      ])).sort();
      const projection = inventoryByDate(from, to, schedule);
      const matsTracked = Number(injectedSettingsModel.read().towelStockBathMat || 0) > 0;

      const days = {};
      for (const date of tripDates) {
        const entry = ledger.entryFor(date);
        if (!entry) continue;
        const isSkipped = entry.kind === 'regular' && skippedDates.has(date);
        if (!isDrawn(entry, isSkipped, matsTracked)) continue;
        const trip = entry.kind === 'extra' ? extraTrips.find((t) => t.date === date) : null;
        days[date] = {
          kind: entry.kind,
          isSkipped,
          dropOff: entry.dropOff,
          pickUp: entry.pickUp,
          stillAtLaundry: entry.stillAtLaundry,
          inventoryAfter: projection[date] || null,
          manualAddition: manualLines[date] || null,
          extraTrip: trip ? { pickUpAll: trip.pickUpAll !== false, pickUp: trip.pickUp || {} } : null,
          leftAtLaundry: entry.kind === 'extra' && entry.pickUpAll === false ? entry.leftAtLaundry : null,
        };
      }
      return res.json({ days });
    },
  };
}

module.exports = { buildController };
