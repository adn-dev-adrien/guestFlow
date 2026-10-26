/**
 * What the feed reads from the core (specs/google-vacation-rentals-feed.md §4.1): the property, its
 * pricing rules, its blocked nights and closures, and the website's quote. Everything goes through
 * the SDK; the arithmetic stays in the core.
 */

const sdk = require('../sdk');
const { computePropertyState } = require('./calendar');
const { addDays, partySizes } = require('./itineraries');

// db: the app database (ctx.db in production, the test database in the suites).
function createSource({ db }) {
  const pricing = sdk.coreModule('pricing');
  const { checkChangeover } = sdk.coreModule('changeover');
  const { computeBlockedDates, rangeHasBlockedNight } = sdk.coreModule('blockedDates');
  const { publicGuestCap } = sdk.coreModule('capacity');
  const directQuote = sdk.coreModule('directQuote');
  const closures = sdk.models.closures(db);

  const propertyRow = (id) => db.prepare('SELECT * FROM properties WHERE id = ?').get(Number(id)) || null;
  // The engine's own read of the rules (pricing.calculateReservationQuote): same rows, same order.
  const rulesOf = (id) => db.prepare('SELECT * FROM pricing_rules WHERE propertyId = ? ORDER BY startDate').all(Number(id));
  const capacityOf = (id) => publicGuestCap(propertyRow(id) || {});

  // The website's quote with no option chosen: the property's default options are merged by
  // directQuote exactly as on the site (rule 4).
  const stayInput = ({ propertyId, startDate, endDate, adults }) => ({
    propertyId: Number(propertyId), startDate, endDate, adults, children: 0, teens: 0, babies: 0, babyBeds: 0, options: [], resources: [],
  });
  const websiteQuote = (stay) => directQuote.buildEngineQuote(stayInput(stay));

  // The same quote for a whole run, bound to a handle on the same database that compiles each SQL
  // statement once instead of once per quote — a quarter of the engine's time over a full horizon.
  // Nothing else differs from the website's call; the price check (rule 17) compares the two.
  function runQuote() {
    const statements = new Map();
    const cached = new Proxy(db, {
      get(target, key) {
        if (key === 'prepare') {
          return (sql) => {
            if (!statements.has(sql)) statements.set(sql, target.prepare(sql));
            return statements.get(sql);
          };
        }
        const value = target[key];
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const { buildEngineQuote } = directQuote.createDirectQuote({
      db: cached,
      calculateReservationQuote: pricing.calculateReservationQuote,
      getTodayIsoDate: () => sdk.coreModule('reservationHelpers').getTodayIsoDate(),
      optionsModel: sdk.coreModule('optionsModel'),
      propertyOptionDefaultsModel: sdk.coreModule('propertyOptionDefaultsModel'),
      mergePropertyDefaultsIntoPayload: sdk.coreModule('propertyDefaultOptions').mergePropertyDefaultsIntoPayload,
      isPerPersonCardOption: sdk.coreModule('mealPortions').isPerPersonCardOption,
    });
    return (stay) => buildEngineQuote(stayInput(stay));
  }

  // reuse: the amounts already sent, for a reservation-caused run (calendar.js).
  function loadState(property, { today, horizonDays, maxLos, reuse = null }) {
    const row = propertyRow(property.id);
    if (!row) throw new Error(`Logement ${property.id} introuvable`);
    const until = addDays(today, horizonDays + maxLos);
    return computePropertyState({
      property: row,
      rules: rulesOf(row.id),
      cap: publicGuestCap(row),
      today,
      horizonDays,
      maxLos,
      blocked: new Set(computeBlockedDates(row.id, today, until)),
      closures: new Set(closures.expandClosuresToDates(closures.list({ propertyId: row.id, from: today, to: until }))),
      reuse,
    }, {
      calculateBaseStayPrice: pricing.calculateBaseStayPrice,
      checkChangeover,
      quote: runQuote(),
    });
  }

  /** What the website answers for one stay, as the price check reads it (rule 17). */
  function quoteWebsite(propertyId, { checkin, nights, guests }) {
    const row = propertyRow(propertyId);
    if (!row || guests > publicGuestCap(row)) return { sellable: false };
    const checkout = addDays(checkin, nights);
    const q = websiteQuote({ propertyId, startDate: checkin, endDate: checkout, adults: guests });
    if (!q || q.error || q.minNightsBreached || q.maxNightsBreached || q.changeoverBreached) return { sellable: false };
    if (rangeHasBlockedNight(checkin, checkout, computeBlockedDates(row.id, checkin, checkout))) return { sellable: false };
    return { sellable: true, amountCents: Math.round(Number(q.totalStayPrice || 0) * 100) };
  }

  const sizesOf = (id) => {
    const row = propertyRow(id);
    return row ? partySizes(row, publicGuestCap(row)) : [];
  };

  return { loadState, quoteWebsite, capacityOf, sizesOf, propertyRow };
}

module.exports = { createSource };
