// specs/reservation-payment-ledger.md §3.8 rules 58-63 — a platform stay sold far from the « Prix
// plateformes » grid of its channel raises ONE alert; everything else says nothing.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const { db, controller, respond, seed, createStay, liveQuote, stayBody, ADMIN } = require('./ledgerFixture');
const {
  platformPriceCheck, BELOW_PERCENT, ABOVE_PERCENT, MIN_GAP_EUR,
} = require('../utils/platformPriceCheck');

seed();
// Property 1: 100 €/night, so a Booking row at 15 % lists it at ceil(100 / 0,85) = 118 € a night.
db.prepare("INSERT INTO platforms (name, commissionPercent) VALUES ('Booking', 15)").run();
db.prepare("INSERT INTO platforms (name, commissionPercent) VALUES ('Airbnb', 15.5)").run();
db.prepare("INSERT INTO platforms (name, commissionPercent) VALUES ('Gitedefrance', 0)").run();
db.prepare("INSERT INTO platforms (name, commissionPercent) VALUES ('Vitrine', 5)").run();
db.prepare("UPDATE platforms SET collectsTouristTax = 0 WHERE name IN ('Booking', 'Airbnb', 'Gitedefrance')").run();
db.prepare(`UPDATE properties SET platformCleaningFees = '[{"platform":"Airbnb","net":122}]' WHERE id = 1`).run();

const THREE_NIGHTS_AT_GRID = 354; // 3 × 118
const checkOf = async (over) => (await liveQuote(null, over)).platformPriceCheck;

test('rule 59 — a stay listed exactly at the grid raises nothing, whatever the commission', async () => {
  assert.equal(await checkOf({ platform: 'Booking', platformGrossAmount: THREE_NIGHTS_AT_GRID }), null);
  assert.equal(await checkOf({ platform: 'Gitedefrance', platformGrossAmount: 300 }), null, '0 % commission: the grid is the net target');
  assert.equal(await checkOf({ platform: 'Booking', platformGrossAmount: 330 }), null, 'a non-refundable rate (-7 %) is inside the band');
});

test('rule 60 — the band: -14,97 % and +24,86 % pass, -15,25 % and +25,14 % alert', async () => {
  assert.equal(await checkOf({ platform: 'Booking', platformGrossAmount: 301 }), null);
  const below = await checkOf({ platform: 'Booking', platformGrossAmount: 300 });
  assert.equal(below.direction, 'below');
  assert.equal(below.gapPercent, -15.3);
  assert.equal(await checkOf({ platform: 'Booking', platformGrossAmount: 442 }), null);
  const above = await checkOf({ platform: 'Booking', platformGrossAmount: 443 });
  assert.equal(above.direction, 'above');
  assert.equal(above.gapPercent, 25.1);
  assert.equal(BELOW_PERCENT, -15);
  assert.equal(ABOVE_PERCENT, 25);
  assert.equal(MIN_GAP_EUR, 30);
});

test('rule 60 — the object carries what the card prints, in euros and one decimal', async () => {
  const check = await checkOf({ platform: 'Booking', platformGrossAmount: 200 });
  assert.deepEqual(check, {
    platformLabel: 'Booking', paid: 200, expected: 354, gap: -154, gapPercent: -43.5, direction: 'below', gridPath: '/properties/1/pricing-seasons',
  });
});

test('rule 60 — the 30 € floor keeps a short stay from alerting on a few euros', async () => {
  const oneNight = { startDate: '2027-08-01', endDate: '2027-08-02' };
  assert.equal(await checkOf({ platform: 'Booking', ...oneNight, platformGrossAmount: 94 }), null, '-20 % but -24 €');
  assert.ok(await checkOf({ platform: 'Booking', ...oneNight, platformGrossAmount: 85 }), '-28 %, -33 €');
});

test('rule 58 — the tourist tax the platform withheld is out of « paid »', async () => {
  db.prepare("UPDATE platforms SET collectsTouristTax = 1, touristTaxRemittedByPlatform = 1 WHERE name = 'Vitrine'").run();
  const grid = Math.ceil(100 / 0.95) * 3;
  assert.equal(await checkOf({ platform: 'Vitrine', platformGrossAmount: grid + 7.2, platformTouristTaxAmount: 7.2 }), null);
  assert.ok(await checkOf({ platform: 'Vitrine', platformGrossAmount: 200 + 7.2, platformTouristTaxAmount: 7.2 }));
});

test('rule 59 — the channel cleaning fee is part of the expected price, grossed up with the commission read now', async () => {
  const fee = Math.ceil(122 / (1 - 0.155));
  const expected = 3 * Math.ceil(100 / (1 - 0.155)) + fee;
  assert.equal(await checkOf({ platform: 'Airbnb', platformGrossAmount: expected }), null);
  const missing = await checkOf({ platform: 'Airbnb', startDate: '2027-08-01', endDate: '2027-08-03', platformGrossAmount: 2 * 119 });
  assert.equal(missing.expected, 2 * 119 + fee, 'two nights without the fee paid: -18 %, -145 €');
  assert.equal(missing.direction, 'below');
});

// Pure util, synthetic inputs: degressivity, legacy seasons, extra guests, the guards of rule 61.
const RULES = [{ id: 1, pricePerNight: 100, extraGuestPrice: 20, dateRanges: '[]' }];
const GRID = {
  platforms: [{ id: 5, name: 'Booking', commissionPercent: 15, cleaningFee: null }],
  seasons: [{ ruleId: 1, byPlatform: { 5: 118 }, extraGuestByPlatform: { 5: 24 } }],
};
const night = (n, price) => ({ date: `2027-09-0${n}`, nightNumber: n, price });
function util(over = {}) {
  const { quote: quoteOver, stay: stayOver, ...rest } = over;
  return platformPriceCheck({
    quote: {
      platformGrossAmount: 354, accommodationAdjustedPrice: 354, extraGuestInBrutSurcharge: 0, unpricedNights: [],
      nightlyBreakdown: [night(1, 100), night(2, 100), night(3, 100)], ...quoteOver,
    },
    stay: { kind: 'reservation', startDate: '2027-09-01', endDate: '2027-09-04', platform: 'Booking', propertyId: 7, ...stayOver },
    nightsReplayed: true,
    today: '2026-10-28',
    loadContext: () => ({ rules: RULES, property: {}, grid: GRID, tariffChangedSinceBooking: false }),
    ...rest,
  });
}

test('rule 59 — the degressivity of the nights is kept (price × grid ÷ billed, night by night)', () => {
  const degressive = { nightlyBreakdown: [night(1, 100), night(2, 70), night(3, 70)] };
  const todays = { nightsReplayed: false };
  assert.equal(util({ ...todays, quote: { ...degressive, platformGrossAmount: 283, accommodationAdjustedPrice: 283 } }), null);
  const full = util({ ...todays, quote: { ...degressive, platformGrossAmount: 354, accommodationAdjustedPrice: 354 } });
  assert.equal(full, null, '+25,0 % of a degressive stay is on the edge of the band');
  const high = util({ ...todays, quote: { ...degressive, platformGrossAmount: 380, accommodationAdjustedPrice: 380 } });
  assert.equal(high.expected, 283.2);
  assert.equal(high.direction, 'above');
});

test('rule 59 — the extra-guest surcharge in the brut is compared with the channel’s extra-guest price', () => {
  const quote = { extraGuestInBrutSurcharge: 40, platformGrossAmount: 394, accommodationAdjustedPrice: 354 };
  assert.equal(util({ quote }), null, '40 € billed × 24 / 20 = 48 € expected: inside the band');
  const cheap = util({ quote: { extraGuestInBrutSurcharge: 0, platformGrossAmount: 354, accommodationAdjustedPrice: 354 } });
  assert.equal(cheap, null);
});

test('rule 61 — the check is not run for a devis, a cancelled stay, a started stay or an own channel', () => {
  const far = { quote: { platformGrossAmount: 150, accommodationAdjustedPrice: 150 } };
  assert.ok(util(far), 'sanity: this stay alerts');
  assert.equal(util({ ...far, stay: { kind: 'devis' } }), null);
  assert.equal(util({ ...far, stay: { kind: 'cancelled' } }), null);
  assert.equal(util({ ...far, stay: { startDate: '2026-10-28' } }), null, 'it has started: the fiche is locked');
  assert.equal(util({ ...far, stay: { platform: 'direct' } }), null);
});

test('rule 61 — nothing is judged without a brut, on an unknown platform, a 100 % commission or an unpriced night', () => {
  const far = { platformGrossAmount: 150, accommodationAdjustedPrice: 150 };
  assert.equal(util({ quote: { ...far, platformGrossAmount: null } }), null);
  assert.equal(util({ quote: far, stay: { platform: 'Inconnue' } }), null);
  assert.equal(util({ quote: far, loadContext: () => ({ rules: RULES, grid: { ...GRID, platforms: [{ id: 5, name: 'Booking', commissionPercent: 100 }] }, tariffChangedSinceBooking: false }) }), null);
  assert.equal(util({ quote: { ...far, unpricedNights: ['2027-09-02'] } }), null);
});

test('rule 61 — today’s nights + a tariff change after the booking date: no check; the same with the nights replayed: checked', () => {
  const ctx = { loadContext: () => ({ rules: RULES, property: {}, grid: GRID, tariffChangedSinceBooking: true }) };
  const far = { quote: { platformGrossAmount: 150, accommodationAdjustedPrice: 150 } };
  assert.equal(util({ ...far, ...ctx, nightsReplayed: false }), null);
  assert.ok(util({ ...far, ...ctx, nightsReplayed: true }));
});

test('rule 61 — replayed nights that no longer match today’s seasons (tariff moved, or a 100 € fallback night) are not judged', () => {
  const far = { platformGrossAmount: 150, accommodationAdjustedPrice: 150 };
  assert.ok(util({ quote: far }), 'sanity: nights equal to today’s seasons are judged');
  const oldTariff = { ...far, nightlyBreakdown: [night(1, 80), night(2, 80), night(3, 80)] };
  assert.equal(util({ quote: oldTariff }), null, 'sold at 80 € a night, the season is 100 € today');
  assert.ok(util({ quote: oldTariff, nightsReplayed: false }), 'today’s nights are always today’s');
  assert.equal(util({ quote: { ...far, nightlyBreakdown: [night(1, 100), night(2, 100)] } }), null, 'a different number of nights');
});

test('rule 59 — a legacy season (no net target) still has a grid cell: pricePerNight grossed up', async () => {
  const q = await liveQuote(null, { platform: 'Booking', platformGrossAmount: THREE_NIGHTS_AT_GRID });
  assert.equal(q.platformPriceCheck, null);
  assert.equal(db.prepare('SELECT netTargetPerNight FROM pricing_rules WHERE propertyId = 1').get().netTargetPerNight, null);
});

test('rule 61 — a saved stay replays its nights; once forced to today’s tariff, a later journal event silences the check', async () => {
  const id = createStay({ platform: 'Booking', platformGrossAmount: 200 });
  assert.ok((await liveQuote(id, { platformGrossAmount: 200 })).platformPriceCheck, 'nights replayed: judged');
  db.prepare("INSERT INTO tariff_change_events (propertyId, kind, occurredAt) VALUES (1, 'platforms', '2999-01-01 00:00:00')").run();
  assert.ok((await liveQuote(id, { platformGrossAmount: 200 })).platformPriceCheck, 'snapshot kept: the guest’s own tariff');
  assert.equal(
    (await liveQuote(id, { platformGrossAmount: 200, forceCurrentPricing: true })).platformPriceCheck,
    null,
    'today’s nights against a grid that changed since the booking',
  );
  db.prepare('DELETE FROM tariff_change_events').run();
});

test('rule 61 — a devis never raises it', async () => {
  const q = await liveQuote(null, { platform: 'Booking', platformGrossAmount: 150, devisId: 0 });
  assert.ok(q.platformPriceCheck, 'sanity: a new reservation alerts');
  const res = respond();
  const row = db.prepare("INSERT INTO reservations (propertyId, clientId, startDate, endDate, kind, platform) VALUES (1, 1, '2027-11-01', '2027-11-04', 'devis', 'Booking')").run();
  await controller.calculatePrice({ body: { ...stayBody({ platform: 'Booking', startDate: '2027-11-01', endDate: '2027-11-04' }), devisId: row.lastInsertRowid, platformGrossAmount: 150 }, user: ADMIN }, res);
  assert.equal(res.body.platformPriceCheck, null);
});

test('rule 63 — the controller answers the check on calculate-price and omits it for a reception-only user', async () => {
  const body = { ...stayBody({ platform: 'Booking' }), platformGrossAmount: 150 };
  const admin = respond();
  await controller.calculatePrice({ body, user: ADMIN }, admin);
  assert.equal(admin.body.platformPriceCheck.platformLabel, 'Booking');
  const reception = respond();
  await controller.calculatePrice({ body, user: { role: 'reception' } }, reception);
  assert.equal('platformPriceCheck' in reception.body, false);
});
