// specs/google-vacation-rentals-feed.md rules 4-9, §7 « Calendar » — the state the feed computes for
// the gîte and the tente priced by the SHIPPED recipes, on the real engine and the real schema: every
// amount is the website's quote tax included, every refusal the engine's, every blocked or closed
// night the website's own.
process.env.DB_PATH = ':memory:';

const { requirePlugins } = require('../../sdk/testing');
if (!requirePlugins(['tariff-recipes'])) return;

const test = require('node:test');
const assert = require('node:assert/strict');

const silent = console.log;
console.log = () => {};
const { seed, loadRecipe } = require('./gvrFixtures');
const { createSource } = require('../source');
const { itineraryKey } = require('../itineraries');
const { calculateReservationQuote } = require('../../../utils/pricing');

const { db, gite, tente } = seed();
console.log = silent;
const source = createSource({ db });

// The website's quote, straight from the engine (no default option on these fixtures).
function engineTotal(propertyId, checkin, nights, guests) {
  const end = new Date(`${checkin}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + nights);
  const q = calculateReservationQuote({
    db, propertyId, startDate: checkin, endDate: end.toISOString().slice(0, 10), adults: guests,
    selectedOptions: [], offeredOptionIds: [], selectedResources: [], platform: 'direct', planningCardAsQuantity: true,
  });
  return q;
}

const PEAK = loadRecipe('gite-2027.json').seasons.find((s) => s.key === 'peak');

let peakState;
test.before(async () => {
  // 10 July 2027: the first Saturday of the Très haute (minimum 4 nights) — specs/tariff-recipe-gite.
  peakState = await source.loadState({ id: gite }, { today: '2027-07-10', horizonDays: 7, maxLos: 8 });
});

test('rule 4 — every amount is the website quote, tax included (gîte, progressive, 4 to 8 nights, 1 to 14 guests)', () => {
  assert.ok(peakState.rates.size > 0);
  peakState.rates.forEach((rate) => {
    const q = engineTotal(gite, rate.checkin, rate.nights, rate.guests);
    assert.equal(rate.amountCents, Math.round(q.totalStayPrice * 100), itineraryKey(rate));
    assert.ok(q.touristTaxTotal > 0, 'the tourist tax is in the total');
    assert.equal(rate.beforeTaxCents, Math.round((q.totalStayPrice - q.touristTaxTotal) * 100));
  });
});

test('the recipe\'s week is four nights, and a party above 10 pays the supplement on top', () => {
  const week = peakState.rates.get(itineraryKey({ checkin: '2027-07-10', nights: 7, guests: 10 }));
  const tax = engineTotal(gite, '2027-07-10', 7, 10).touristTaxTotal;
  assert.equal(week.amountCents - Math.round(tax * 100), PEAK.pricePerNight * 4 * 100, '7 nights = 4 × the Très haute night');
  const eleven = peakState.rates.get(itineraryKey({ checkin: '2027-07-10', nights: 7, guests: 11 }));
  const elevenQuote = engineTotal(gite, '2027-07-10', 7, 11);
  assert.ok(elevenQuote.extraGuestSurcharge > 0);
  assert.equal(eleven.amountCents, Math.round(elevenQuote.totalStayPrice * 100));
  assert.ok(eleven.amountCents > week.amountCents);
});

test('rule 5 — a stay under the minimum is not priced; rule 7 — the arrival carries that minimum', () => {
  for (let n = 1; n <= 3; n += 1) {
    assert.equal(peakState.rates.has(itineraryKey({ checkin: '2027-07-12', nights: n, guests: 2 })), false, `${n} nights`);
  }
  assert.equal(peakState.rates.has(itineraryKey({ checkin: '2027-07-12', nights: 4, guests: 2 })), true);
  assert.equal(peakState.days.get('2027-07-12').minLos, 4);
  assert.equal(peakState.days.get('2027-07-12').inventory, 1);
});

test('rule 8 — no stay reaches past the horizon, and the days after it are sent closed', () => {
  peakState.rates.forEach((rate) => {
    assert.ok(rate.checkin < '2027-07-17');
  });
  assert.equal(peakState.rates.has(itineraryKey({ checkin: '2027-07-12', nights: 6, guests: 2 })), false, 'ends on 18 July, past the horizon');
  assert.deepEqual(peakState.days.get('2027-07-17'), {
    date: '2027-07-17', inventory: 0, minLos: null, maxLos: null, closedToArrival: 0, closedToDeparture: 0, closed: 1,
  });
  assert.equal(peakState.days.size, 7 + 8);
});

test('rules 5-6 — a booked night: inventory 0 and every stay crossing it omitted; a stay ending on it kept', async () => {
  const client = db.prepare("INSERT INTO clients (lastName, firstName) VALUES ('Test', 'Bloc')").run().lastInsertRowid;
  db.prepare("INSERT INTO reservations (propertyId, clientId, startDate, endDate, kind, checkInTime, checkOutTime) VALUES (?, ?, '2027-07-15', '2027-07-17', 'reservation', '16:00', '10:00')")
    .run(tente, client);
  const state = await source.loadState({ id: tente }, { today: '2027-07-10', horizonDays: 14, maxLos: 7 });
  assert.equal(state.days.get('2027-07-15').inventory, 0);
  assert.equal(state.days.get('2027-07-16').inventory, 0);
  assert.equal(state.days.get('2027-07-17').inventory, 1);
  assert.equal(state.rates.has(itineraryKey({ checkin: '2027-07-13', nights: 3, guests: 2 })), false, 'crosses the 15th');
  assert.equal(state.rates.has(itineraryKey({ checkin: '2027-07-13', nights: 2, guests: 2 })), true, 'leaves on the 15th');
  assert.equal(state.rates.has(itineraryKey({ checkin: '2027-07-17', nights: 2, guests: 2 })), true, 'arrives on the 17th');
  const q = engineTotal(tente, '2027-07-13', 2, 4);
  assert.equal(state.rates.get(itineraryKey({ checkin: '2027-07-13', nights: 2, guests: 4 })).amountCents, Math.round(q.totalStayPrice * 100), 'tente, 4 guests (supplement above 2)');
});

test('rule 7 — a closure (the tente\'s winter) is a master close at inventory 0, with nothing priced', async () => {
  const state = await source.loadState({ id: tente }, { today: '2027-10-10', horizonDays: 10, maxLos: 7 });
  assert.equal(state.days.get('2027-10-14').closed, 0);
  ['2027-10-15', '2027-10-18'].forEach((date) => {
    assert.equal(state.days.get(date).closed, 1, date);
    assert.equal(state.days.get(date).inventory, 0, date);
  });
  assert.equal(state.rates.has(itineraryKey({ checkin: '2027-10-13', nights: 2, guests: 2 })), true, 'leaves on the 15th');
  assert.equal(state.rates.has(itineraryKey({ checkin: '2027-10-14', nights: 2, guests: 2 })), false);
  assert.equal([...state.rates.values()].some((r) => r.checkin >= '2027-10-15'), false);
});

test('rule 7 — a changeover day: closed to arrival elsewhere, and the stays that breach it omitted', async () => {
  const property = Number(db.prepare("INSERT INTO properties (name, maxGuests, basePriceIncludedGuests) VALUES ('Samedi', 2, 2)").run().lastInsertRowid);
  db.prepare(`INSERT INTO pricing_rules (propertyId, label, pricePerNight, pricingMode, dateRanges, minNights, changeoverArrival, changeoverDeparture)
    VALUES (?, 'Été', 100, 'fixed', '[{"startDate":"2027-07-01","endDate":"2027-07-31"}]', 1, 6, 6)`).run(property);
  const state = await source.loadState({ id: property }, { today: '2027-07-10', horizonDays: 14, maxLos: 7 });
  // 10 and 17 July 2027 are Saturdays.
  assert.equal(state.days.get('2027-07-10').closedToArrival, 0);
  assert.equal(state.days.get('2027-07-11').closedToArrival, 1);
  assert.equal(state.days.get('2027-07-17').closedToDeparture, 0);
  assert.equal(state.days.get('2027-07-16').closedToDeparture, 1);
  // Saturday to Saturday within 7 nights: the weeks of the 10th and of the 17th are the only stays sold.
  assert.deepEqual([...new Set([...state.rates.values()].map((r) => `${r.checkin}+${r.nights}`))], ['2027-07-10+7', '2027-07-17+7']);
});

test('edge case — a night no pricing rule covers is closed, and no stay touching it is priced', async () => {
  const property = Number(db.prepare("INSERT INTO properties (name, maxGuests, basePriceIncludedGuests) VALUES ('Trou', 2, 2)").run().lastInsertRowid);
  db.prepare(`INSERT INTO pricing_rules (propertyId, label, pricePerNight, pricingMode, dateRanges, minNights)
    VALUES (?, 'Court', 80, 'fixed', '[{"startDate":"2027-07-01","endDate":"2027-07-12"}]', 1)`).run(property);
  const state = await source.loadState({ id: property }, { today: '2027-07-10', horizonDays: 6, maxLos: 4 });
  assert.equal(state.days.get('2027-07-12').closed, 0);
  assert.equal(state.days.get('2027-07-13').closed, 1, 'the engine would bill its 100 € fallback: never sent');
  assert.equal(state.rates.has(itineraryKey({ checkin: '2027-07-11', nights: 2, guests: 2 })), true);
  assert.equal(state.rates.has(itineraryKey({ checkin: '2027-07-11', nights: 3, guests: 2 })), false);
  assert.equal(state.rates.has(itineraryKey({ checkin: '2027-07-13', nights: 1, guests: 2 })), false);
});

test('rule 11 — a reservation run reuses the amounts already sent and quotes only what became sellable', async () => {
  const full = await source.loadState({ id: tente }, { today: '2027-08-01', horizonDays: 5, maxLos: 3 });
  const reuse = new Map([...full.rates].map(([key, rate]) => [key, rate.amountCents]));
  const again = await source.loadState({ id: tente }, { today: '2027-08-01', horizonDays: 5, maxLos: 3, reuse });
  assert.equal(again.quotes, 0);
  assert.deepEqual([...again.rates.keys()], [...full.rates.keys()]);
  const firstKey = [...reuse.keys()][0];
  reuse.delete(firstKey);
  const partial = await source.loadState({ id: tente }, { today: '2027-08-01', horizonDays: 5, maxLos: 3, reuse });
  assert.equal(partial.quotes, full.sizes.length, 'the stay missing one party size is quoted again, every size');
});
