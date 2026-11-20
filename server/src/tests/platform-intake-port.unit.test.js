// specs/pricing-components.md §3 rule 71 (PR A) — the SDK `reservations.update` of an intake patch runs through the payload shape
// of the future `fromPlatform` port (`utils/platformIntakePort.js`) and saves exactly as it always did. Contract: the SDK
// surface is unchanged, the patch the plugins write comes back identical from the port's payload, a line's `inComplement` is
// read as `collectAt` on a platform stay, and a started stay is still refused. The replay of the stored intakes at 0 diff is
// `platform-intake-replay`; the three intake plugins' own suites stay green unchanged.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const { toPlatformIntake, toUpdatePatch, isIntakeOnStartedStay, collectAtOf } = require('../utils/platformIntakePort');
const core = require('../plugins/sdk/coreServices');

// The fields the three intake plugins set: Booking (gross, payout, withheld tax, commission, lines), Airbnb (cleaning fee as a
// custom line paid to the platform), Gîtes de France (supplements paid to the platform, an option collected on arrival).
const BOOKING = {
  platform: 'Booking', reservationNumber: '6669322709', adults: 2, children: 1, teens: 0, babies: 0, singleBeds: 1, doubleBeds: 1, babyBeds: 0, checkInTime: '16:00',
  platformGrossAmount: 640.5, platformTouristTaxAmount: 12.1, platformPayoutAmount: 540, platformCommissionAmount: 88.4,
  notes: 'note', options: [{ optionId: 7, quantity: 1, inComplement: 0, offered: false }, { optionId: 9, quantity: 2, inComplement: 1 }],
  customOptions: [{ description: 'Line 1', amount: 55, inComplement: 0, offered: false }], offeredOptionIds: [3],
};
const AIRBNB = { platform: 'Airbnb', platformGrossAmount: 400, customOptions: [{ description: 'Cleaning', amount: 40, inComplement: 0 }], options: [] };
const GITES = { platform: 'Gites de France', platformGrossAmount: 500, options: [{ optionId: 4, quantity: 1, inComplement: 1 }], customOptions: [], clientId: 12 };

test('rule 71: the SDK surface of reservations.update is unchanged — name, arguments, the neighbours the plugins call', () => {
  assert.deepEqual(Object.keys(core.reservations).sort(), ['fromPlatform', 'getByIdWithDetails', 'platformCommission', 'platformWithholdsTouristTax', 'suggestBeds', 'update', 'updateBody']);
  assert.equal(typeof core.reservations.update, 'function');
  assert.ok(Object.isFrozen(core.reservations));
});

test('rule 71: the patch of each plugin comes back identical from the port payload (the adapter changes nothing it saves)', () => {
  for (const patch of [BOOKING, AIRBNB, GITES, {}, { adults: 3 }, { platformGrossAmount: undefined }, { options: null }]) {
    const back = toUpdatePatch(toPlatformIntake(patch, { platform: 'Booking' }));
    assert.deepEqual(back, patch);
    assert.deepEqual(Object.keys(back).sort(), Object.keys(patch).sort());
  }
  assert.deepEqual(toUpdatePatch(toPlatformIntake(null)), {});
});

test('rule 71: the payload is the port\'s shape — platform, number, stay, party, beds, money, notes, lines', () => {
  const intake = toPlatformIntake(BOOKING);
  assert.equal(intake.platform, 'Booking');
  assert.equal(intake.reservationNumber, '6669322709');
  assert.deepEqual(intake.stay, { checkInTime: '16:00' });
  assert.deepEqual(intake.party, { adults: 2, children: 1, teens: 0, babies: 0 });
  assert.deepEqual(intake.beds, { singleBeds: 1, doubleBeds: 1, babyBeds: 0 });
  assert.deepEqual(intake.money, { gross: 640.5, payout: 540, withheldTax: 12.1, commission: 88.4 });
  assert.equal(intake.notes, 'note');
  assert.deepEqual(intake.rest, { offeredOptionIds: [3] }, 'what the port does not name travels untouched');
  assert.deepEqual(toPlatformIntake(GITES).rest, { clientId: 12 });
});

test('rule 71: on a platform stay a line\'s inComplement 0 / 1 is read as collectAt platform / arrival', () => {
  assert.equal(collectAtOf(0), 'platform');
  assert.equal(collectAtOf(1), 'arrival');
  assert.equal(collectAtOf(true), 'arrival');
  const intake = toPlatformIntake(BOOKING);
  assert.deepEqual(intake.lines.options.map((l) => l.collectAt), ['platform', 'arrival']);
  assert.deepEqual(intake.lines.customOptions.map((l) => l.collectAt), ['platform']);
  assert.equal(intake.includedLines.length, 2, 'the lines paid to the platform');
  assert.equal(intake.complementLines.length, 1, 'the lines collected on arrival');
  assert.ok(toUpdatePatch(intake).options.every((l) => !('collectAt' in l)), 'the save never sees collectAt');
});

test('rule 71: an own-channel stay is not read as a platform sale (no collectAt), and the stored platform decides when the patch names none', () => {
  const own = toPlatformIntake({ options: [{ optionId: 1, inComplement: 1 }] }, { platform: 'direct' });
  assert.ok(!('collectAt' in own.lines.options[0]));
  const named = toPlatformIntake({ options: [{ optionId: 1, inComplement: 1 }] }, { platform: 'Booking' });
  assert.equal(named.lines.options[0].collectAt, 'arrival');
  const noFlag = toPlatformIntake({ options: [{ optionId: 1 }] }, { platform: 'Booking' });
  assert.ok(!('collectAt' in noFlag.lines.options[0]), 'a line without the flag stays as written');
});

test('rule 71: a started stay is refused by the day, as the intakes always did', () => {
  assert.equal(isIntakeOnStartedStay('2026-11-11', '2026-11-11'), true); // date-literal-ok: a pure comparison of two given days, nothing compares with today
  assert.equal(isIntakeOnStartedStay('2026-11-10', '2026-11-11'), true); // date-literal-ok: a pure comparison of two given days
  assert.equal(isIntakeOnStartedStay('2026-11-12', '2026-11-11'), false); // date-literal-ok: a pure comparison of two given days
});

test('rule 71: through the SDK an unknown stay is 404 and a started stay is 409 PAST_RESERVATION — nothing written', () => {
  const db = require('../database');
  assert.deepEqual(core.reservations.update(987654, { adults: 2 }), { status: 404, body: { error: 'Réservation introuvable' } });
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Port')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Guest', 'One')").run();
  db.prepare("INSERT INTO reservations (id, kind, propertyId, clientId, startDate, endDate, platform, finalPrice, totalPrice) VALUES (50, 'reservation', 1, 1, '2020-01-01', '2020-01-03', 'Booking', 100, 100)").run();
  const refused = core.reservations.update(50, { adults: 4 });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, 'PAST_RESERVATION');
  assert.notEqual(db.prepare('SELECT adults FROM reservations WHERE id = 50').get().adults, 4);
});

// ── rule 71, PR B: `reservations.fromPlatform`, and rule 17: the moment of each line is declared ───────────────────────────────────
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

function platformStay(platform, id) {
  const db = require('../database');
  db.prepare("INSERT OR IGNORE INTO properties (id, name) VALUES (1, 'Port')").run();
  db.prepare('UPDATE properties SET maxGuests = 6 WHERE id = 1').run();
  db.prepare("INSERT OR IGNORE INTO clients (id, firstName, lastName) VALUES (1, 'Guest', 'One')").run();
  db.prepare("INSERT OR IGNORE INTO pricing_rules (propertyId, label, pricePerNight) VALUES (1, 'Standard', 100)").run();
  for (const [optionId, title] of [[71, 'Linge'], [72, 'Bois']]) {
    db.prepare("INSERT OR IGNORE INTO options (id, title, price, priceType) VALUES (?, ?, 20, 'per_stay')").run(optionId, title);
    db.prepare('INSERT OR IGNORE INTO property_options (propertyId, optionId) VALUES (1, ?)').run(optionId);
  }
  const start = addDaysToIsoDate(todayIso(), 60 + id);
  db.prepare("INSERT INTO reservations (id, kind, propertyId, clientId, startDate, endDate, platform, adults, finalPrice, totalPrice) VALUES (?, 'reservation', 1, 1, ?, ?, ?, 2, 300, 300)")
    .run(id, start, addDaysToIsoDate(start, 3), platform);
  return db;
}

test('rule 71 (PR B): fromPlatform saves the port payload as update saves the patch, and update is that same save', () => {
  const db = platformStay('Booking', 61);
  const intake = toPlatformIntake({ platform: 'Booking', adults: 3, options: [{ optionId: 71, quantity: 1, inComplement: 0 }, { optionId: 72, quantity: 1, inComplement: 1 }] }, { platform: 'Booking' });
  const result = core.reservations.fromPlatform(61, intake, { label: 'Booking (mail)' });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(db.prepare('SELECT adults FROM reservations WHERE id = 61').get().adults, 3);
  const viaUpdate = core.reservations.update(61, { adults: 2 }, { label: 'Booking (mail)' });
  assert.equal(viaUpdate.status, 200);
  assert.equal(db.prepare('SELECT adults FROM reservations WHERE id = 61').get().adults, 2);
  assert.equal(core.reservations.fromPlatform(987655, intake).status, 404);
});

test('rule 17: the lines a platform intake wrote carry source intake and a declared moment — platform inside the price, arrival collected by the host', () => {
  const db = platformStay('Booking', 62);
  core.reservations.update(62, { options: [{ optionId: 71, quantity: 1, inComplement: 0 }, { optionId: 72, quantity: 1, inComplement: 1 }] });
  const rows = db.prepare('SELECT optionId, source, collectAt, collectAtDefault, soldAt FROM reservation_options WHERE reservationId = 62 ORDER BY optionId').all();
  assert.deepEqual(rows.map((r) => [r.optionId, r.source, r.collectAt, r.collectAtDefault]), [[71, 'intake', 'platform', 'platform'], [72, 'intake', 'arrival', 'arrival']]);
  assert.ok(rows.every((r) => r.soldAt));
});

test('rule 17: a line sold after the booking is never declared a platform line — a second intake leaves a declared moment alone', () => {
  const db = platformStay('Booking', 63);
  core.reservations.update(63, { options: [{ optionId: 71, quantity: 1, inComplement: 0 }] });
  db.prepare("UPDATE reservation_options SET collectAt = 'departure', source = 'fiche' WHERE reservationId = 63").run();
  core.reservations.update(63, { adults: 3 });
  const row = db.prepare('SELECT source, collectAt FROM reservation_options WHERE reservationId = 63').get();
  assert.deepEqual([row.source, row.collectAt], ['fiche', 'departure']);
});

test('rule 17: an own-channel stay is no platform sale — its lines are not declared by the intake path', () => {
  const db = platformStay('direct', 64);
  core.reservations.update(64, { options: [{ optionId: 71, quantity: 1, inComplement: 0 }] });
  assert.equal(db.prepare('SELECT collectAt FROM reservation_options WHERE reservationId = 64').get().collectAt, null);
});
