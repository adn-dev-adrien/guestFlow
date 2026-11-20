/**
 * The resource scheduler this plugin declares to the core (specs/guest-app.md rules 28-31, SDK 2.26.0): the
 * slots of an hourly resource over a stay, and the authoritative check of the sessions a guest asks for. Built
 * on the plugin's own functions, so a guest sees exactly what the SAS picker and Calendrier › Ressources see:
 *   - occupancy = `occupancyModel.listForStay` — every guest session, every outside booking, every held slot,
 *     the stay's own sessions included (a guest order adds to them, it never replaces them);
 *   - slots = `availability.buildDays` / `validateBlock` — grid, opening, closed days, turnover, capacity,
 *     heat-up and retention, the past, check-in → check-out;
 *   - prices = `hourlyPricing` — the lodging's day rate, the evening rate after `hourlyEveningStart`.
 *
 * `canIgnite({ date, time })` is the caller's: whether someone is there to light a cold resource at
 * `start − heatUpMinutes` (rule 31). A slot it refuses is `staff`. No identity ever leaves this module.
 */

const sdk = require('../sdk');
const occupancyModel = require('./occupancyModel');
const { eachDate } = require('./schedulingModel');
const {
  buildDays, validateBlock, toAbsMinutes, minutesToTime, MINUTES_PER_DAY,
} = require('./availability');
const {
  normalizeConfig, slotPrice, toMinutes, eveningSupplement,
} = require('./hourlyPricing');

const resourcesModel = sdk.coreModule('resourcesModel');
const { roundMoney } = sdk.coreModule('money');
const { toParisIso } = sdk.coreModule('stayWindow');

const HOURLY = 'per_hour';

const dateOfAbsolute = (minutes) => new Date(Math.floor(minutes / MINUTES_PER_DAY) * 86400000).toISOString().slice(0, 10);

/**
 * `notBefore` = max(now, check-in), `notAfter` = check-out, in absolute minutes of the Paris wall clock. `heatFrom`
 * (hourly-resource-quantity-and-sas-scheduling.md rule 36) is the moment the heating can begin, when the caller counts it
 * from somewhere other than `notBefore`: the guest app passes the present moment.
 */
function boundsOf(stay, now, heatFrom = null) {
  const paris = toParisIso(now) || '';
  const nowAbs = toAbsMinutes(paris.slice(0, 10), paris.slice(11, 16));
  const checkIn = toAbsMinutes(stay.startDate, stay.checkInTime || '15:00');
  const checkOut = toAbsMinutes(stay.endDate || stay.startDate, stay.checkOutTime || '10:00');
  const bounds = { notBefore: Math.max(checkIn, nowAbs), notAfter: checkOut };
  if (heatFrom) {
    const heat = toParisIso(heatFrom) || '';
    bounds.heatFrom = toAbsMinutes(heat.slice(0, 10), heat.slice(11, 16));
  }
  return bounds;
}

const igniterOf = (canIgnite) => (typeof canIgnite === 'function'
  ? (minutes) => Boolean(canIgnite({ date: dateOfAbsolute(minutes), time: minutesToTime(minutes) }))
  : null);

const rateOf = (resource) => ({
  dayRate: resource.price,
  eveningRate: resource.hourlyEveningRate,
  eveningStart: resource.hourlyEveningStart,
  slotMinutes: resource.slotDuration,
});

const asSession = (s) => ({ date: String((s && s.date) || ''), start: String((s && s.start) || ''), end: String((s && s.end) || '') });

function createScheduler(database) {
  const resources = resourcesModel.create(database);
  const occupancy = occupancyModel.create(database);

  /** The hourly resource, with the lodging's effective price, or null. */
  function hourlyResource(resourceId, propertyId) {
    return resources.list(Number(propertyId))
      .find((r) => Number(r.id) === Number(resourceId) && r.priceType === HOURLY) || null;
  }

  const occupancyOf = (resource, stay) => occupancy.listForStay({ resourceId: resource.id, startDate: stay.startDate, endDate: stay.endDate });

  /**
   * → `{ resourceId, days: [{ date, closed, slots: [{ start, end, state, price }] }] }`, or null when the
   * resource is not an hourly resource of the lodging. `state ∈ free | evening | taken | closed | heating |
   * staff | past`; `evening` is a free slot that reaches the evening rate; `price` is the slot's gross price.
   */
  function slotsForStay({
    resourceId, propertyId, stay, now = new Date(), canIgnite = null, heatFrom = null,
  }) {
    const resource = hourlyResource(resourceId, propertyId);
    if (!resource) return null;
    const rate = rateOf(resource);
    const eveningFrom = normalizeConfig(rate).eveningStart;
    const days = buildDays({
      resource,
      dayRate: resource.price,
      stayDates: eachDate(stay.startDate, stay.endDate),
      occupancy: occupancyOf(resource, stay),
      ...boundsOf(stay, now, heatFrom),
      canIgnite: igniterOf(canIgnite),
    });
    return {
      resourceId: Number(resource.id),
      // The resource's own opening, for the thin bar of the day (guest-app rule 78): closed hours are greyed by the app.
      opening: { from: resource.openTime || '00:00', to: resource.closeTime || '23:59' },
      days: days.map((day) => ({
        date: day.date,
        closed: day.closed,
        slots: day.slots.map((slot) => ({
          start: slot.start,
          end: slot.end,
          state: slot.state === 'free' && toMinutes(slot.end) > eveningFrom ? 'evening' : slot.state,
          // The slot's band and its evening difference (guest-app rule 84): the app words them, the plugin prices them.
          band: toMinutes(slot.end) > eveningFrom ? 'evening' : 'day',
          supplement: slot.supplement,
          price: slotPrice(slot.start, slot.end, rate),
        })),
      })),
    };
  }

  /**
   * The authoritative check of the sessions of one request (rule 29), in their order:
   * `{ ok, results: [{ date, start, end, ok, reason? }] }`, or null when the resource is not hourly here.
   * Taken in time order, each against the planning plus the sessions accepted before it: a session of the
   * request occupies the resource and keeps it warm for the next one, and a session warm only thanks to one
   * that was refused is judged cold — its ignition is checked again.
   * `reason ∈ duration | closed | past | taken | heating | staff`.
   */
  function validateSessions({
    resourceId, propertyId, stay, sessions = [], now = new Date(), canIgnite = null, heatFrom = null,
  }) {
    const resource = hourlyResource(resourceId, propertyId);
    if (!resource) return null;
    const bounds = boundsOf(stay, now, heatFrom);
    const stored = occupancyOf(resource, stay);
    const ignite = igniterOf(canIgnite);
    const asked = (Array.isArray(sessions) ? sessions : []).map(asSession);
    const startOf = (s) => toAbsMinutes(s.date, s.start) || 0;
    const order = asked.map((session, index) => ({ session, index })).sort((a, b) => startOf(a.session) - startOf(b.session));
    const accepted = [];
    const results = [];
    order.forEach(({ session, index }) => {
      const verdict = validateBlock({ resource, block: session, occupancy: [...stored, ...accepted], ...bounds, canIgnite: ignite });
      results[index] = { ...session, ok: verdict.ok, ...(verdict.ok ? {} : { reason: verdict.reason }) };
      if (verdict.ok) accepted.push(session);
    });
    return { ok: results.every((r) => r.ok), results };
  }

  /**
   * The evening supplement of an order's sessions (guest-app rules 81-83): the evening difference of those sessions over the day rate minus what
   * the order's line already bills above the day rate, never below 0. `lineGain` = `{ amount, hours }`: what the line adds to the stay and the
   * billed hours it gains (the free minutes and the hours the stay holds are valued at the day rate, so an offered evening hour owes the difference).
   */
  function orderSupplement({
    resourceId, propertyId, sessions = [], lineGain = {},
  }) {
    const resource = hourlyResource(resourceId, propertyId);
    if (!resource) return 0;
    const difference = eveningSupplement((Array.isArray(sessions) ? sessions : []).map(asSession), {
      dayRate: Number(resource.price || 0),
      eveningRate: Number(resource.hourlyEveningRate) || 0,
      eveningStart: resource.hourlyEveningStart || null,
      slotMinutes: Number(resource.slotDuration || 60),
    });
    const credit = Math.max(0, roundMoney((Number(lineGain.amount) || 0) - Number(resource.price || 0) * (Number(lineGain.hours) || 0)));
    return Math.max(0, roundMoney(difference - credit));
  }

  return { slotsForStay, validateSessions, orderSupplement };
}

module.exports = { createScheduler };
