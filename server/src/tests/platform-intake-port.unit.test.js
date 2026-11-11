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
  assert.deepEqual(Object.keys(core.reservations).sort(), ['getByIdWithDetails', 'platformCommission', 'platformWithholdsTouristTax', 'suggestBeds', 'update', 'updateBody']);
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
