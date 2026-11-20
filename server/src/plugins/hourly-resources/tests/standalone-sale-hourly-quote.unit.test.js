// specs/gift-voucher-campaigns.md rules 4, 5, 43-44 (§4.1) — the dateless quote of an hourly resource, asked of the core's sale with `session: { band, minutes,
// rankOffsetMinutes }`: the external rate of the band, the degressive tiers by hour rank, whole slots, the outside VAT of the resource's class. A quote only:
// `sell` keeps refusing a session (it is booked from the planning). Generic: the code under test names no consumer.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const db = require('../../../database');
const standaloneSale = require('../../../utils/standaloneSale');
const sales = require('../../../models/standaloneSalesModel');
const { liveHourlyResources, withdrawHourlyResources } = require('../../../tests/hourlyResourcesFixture');

const TIERS = [{ fromHour: 2, percent: 10 }, { fromHour: 3, percent: 20 }];
const resource = (over = {}) => {
  const row = {
    name: 'Bain dateless', price: 25, priceType: 'per_hour', showsPlanningCard: 1, slotDuration: 60, minimumUsageMinutes: 60, openTime: '10:00', closeTime: '22:00',
    hourlyEveningStart: '19:00', hourlyEveningRate: 35, hourlyExternalDayRate: 50, hourlyExternalEveningRate: 70, hourlyDegressiveTiers: JSON.stringify(TIERS), sellableExternally: 1, ...over,
  };
  return Number(db.prepare(`INSERT INTO resources (name, price, priceType, showsPlanningCard, slotDuration, minimumUsageMinutes, openTime, closeTime, hourlyEveningStart, hourlyEveningRate,
    hourlyExternalDayRate, hourlyExternalEveningRate, hourlyDegressiveTiers, sellableExternally)
    VALUES (@name, @price, @priceType, @showsPlanningCard, @slotDuration, @minimumUsageMinutes, @openTime, @closeTime, @hourlyEveningStart, @hourlyEveningRate,
    @hourlyExternalDayRate, @hourlyExternalEveningRate, @hourlyDegressiveTiers, @sellableExternally)`).run(row).lastInsertRowid);
};
sales.setExternalRate('resources', 20);

const quote = (id, session) => standaloneSale.quote({ lines: [{ articleRef: `resource:${id}`, session }] });
const refusalOf = (answer) => answer.refusals.map((r) => [r.code, r.message]);

liveHourlyResources();

test('2 h in the day band is 50 + 45 = 95 €, 2 h in the evening band 70 + 63 = 133 €, with the outside VAT of the class', () => {
  const id = resource();
  const day = quote(id, { band: 'day', minutes: 120 });
  assert.equal(day.status, 200);
  assert.deepEqual(day.refusals, []);
  assert.equal(day.document.totals.totalCents, 9500);
  assert.deepEqual(day.document.lines.map((l) => [l.label, l.totalCents, l.vatRate, l.vatCents]), [['Bain dateless', 9500, 20, 1583]]);
  assert.deepEqual(day.document.lines[0].components.map((c) => [c.label, c.amountCents]), [['Jour · 10:00–11:00', 5000], ['Jour · 11:00–12:00', 4500]]);
  const evening = quote(id, { band: 'evening', minutes: 120 });
  assert.equal(evening.document.totals.totalCents, 13300);
  assert.deepEqual(evening.document.vatByRate, [{ rate: 20, vatCents: 2217 }]);
});

test('a quote writes nothing, and a sale of the same session is still refused (a session is booked from the planning)', () => {
  const id = resource();
  const before = db.prepare('SELECT COUNT(*) AS n FROM standalone_sales').get().n;
  quote(id, { band: 'day', minutes: 60 });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM standalone_sales').get().n, before);
  const sold = standaloneSale.sell({ lines: [{ articleRef: `resource:${id}`, session: { band: 'day', minutes: 60 } }] });
  assert.equal(sold.status, 400);
  assert.equal(sold.body.code, 'NEEDS_FULFILMENT');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM standalone_sales').get().n, before);
});

test('the ranks continue after the time already covered: one more hour after 2 h is the 3rd hour at −20 %', () => {
  const id = resource();
  assert.equal(quote(id, { band: 'day', minutes: 60, rankOffsetMinutes: 120 }).document.totals.totalCents, 4000);
  assert.equal(quote(id, { band: 'evening', minutes: 60, rankOffsetMinutes: 60 }).document.totals.totalCents, 6300);
  const whole = quote(id, { band: 'day', minutes: 180 }).document.totals.totalCents;
  const parts = quote(id, { band: 'day', minutes: 120 }).document.totals.totalCents + 4000;
  assert.equal(whole, parts, 'priced in two lines or in one, the session costs the same');
});

test('half-hour slots, and a linear resource keeps its flat rate', () => {
  const half = resource({ name: 'Bain demi-heure', slotDuration: 30, minimumUsageMinutes: 60 });
  assert.equal(quote(half, { band: 'day', minutes: 90 }).document.totals.totalCents, 7250);
  const linear = resource({ name: 'Bain linéaire', hourlyDegressiveTiers: '[]' });
  assert.equal(quote(linear, { band: 'day', minutes: 180 }).document.totals.totalCents, 15000);
});

test('a duration that is not a whole number of slots is refused with a sentence naming the resource and the value', () => {
  const id = resource({ name: 'Bain 30', slotDuration: 30, minimumUsageMinutes: 60 });
  assert.deepEqual(refusalOf(quote(id, { band: 'day', minutes: 75 })), [['SESSION_STEP', '« Bain 30 » se réserve par tranches de 30 min : 75 min ne convient pas.']]);
});

test('a duration below the resource minimum is refused', () => {
  const id = resource({ name: 'Bain mini', slotDuration: 30, minimumUsageMinutes: 90 });
  assert.deepEqual(refusalOf(quote(id, { band: 'day', minutes: 60 })), [['SESSION_TOO_SHORT', '« Bain mini » se réserve pour 90 min au moins : 60 min est trop court.']]);
  assert.equal(quote(id, { band: 'day', minutes: 90 }).refusals.length, 0);
});

test('a duration that does not fit in its band is refused with the band hours', () => {
  const id = resource({ name: 'Bain bande' });
  assert.deepEqual(refusalOf(quote(id, { band: 'day', minutes: 600 })), [['SESSION_OUT_OF_BAND', '« Bain bande » : 10 h ne tiennent pas dans la journée (10:00–19:00).']]);
  assert.deepEqual(refusalOf(quote(id, { band: 'evening', minutes: 240 })), [['SESSION_OUT_OF_BAND', '« Bain bande » : 4 h ne tiennent pas dans la soirée (19:00–22:00).']]);
  assert.deepEqual(refusalOf(quote(id, { band: 'day', minutes: 60, rankOffsetMinutes: 540 })), [['SESSION_OUT_OF_BAND', '« Bain bande » : 10 h ne tiennent pas dans la journée (10:00–19:00).']]);
});

test('an unknown band, a resource with no evening, a band with no external rate and a resource sold nowhere are each refused in French', () => {
  const noEvening = resource({ name: 'Bain sans soir', hourlyEveningStart: null });
  assert.deepEqual(refusalOf(quote(noEvening, { band: 'evening', minutes: 60 })), [['SESSION_BAND_UNKNOWN', '« Bain sans soir » n’a pas de tranche du soir.']]);
  assert.equal(quote(noEvening, { band: 'day', minutes: 60 }).document.totals.totalCents, 5000);
  const noRate = resource({ name: 'Bain gratuit', price: 0, hourlyEveningRate: 0, hourlyExternalDayRate: 0, hourlyExternalEveningRate: 0 });
  assert.deepEqual(refusalOf(quote(noRate, { band: 'day', minutes: 60 })), [['SESSION_BAND_NOT_SOLD', '« Bain gratuit » n’a pas de tarif extérieur pour la journée.']]);
  const hidden = resource({ name: 'Bain caché', sellableExternally: 0 });
  assert.deepEqual(refusalOf(quote(hidden, { band: 'day', minutes: 60 })), [['NOT_SELLABLE', 'Article non vendable hors séjour.']]);
  const nonsense = quote(resource(), { band: 'night', minutes: 60 });
  assert.equal(nonsense.refusals[0].code, 'SESSION_BAND_UNKNOWN');
});

test('the external rate falls back to the guest rate the way a booking does', () => {
  const id = resource({ name: 'Bain repli', hourlyExternalDayRate: 0, hourlyExternalEveningRate: 0, price: 40, hourlyEveningRate: 60 });
  assert.equal(quote(id, { band: 'day', minutes: 60 }).document.totals.totalCents, 4000);
  assert.equal(quote(id, { band: 'evening', minutes: 60 }).document.totals.totalCents, 6000);
});

test('with the hourly plugin withdrawn a session cannot be quoted', () => {
  const id = resource();
  withdrawHourlyResources();
  assert.deepEqual(refusalOf(quote(id, { band: 'day', minutes: 60 })), [['NEEDS_FULFILMENT', 'Une séance se réserve au planning.']]);
  liveHourlyResources();
});
