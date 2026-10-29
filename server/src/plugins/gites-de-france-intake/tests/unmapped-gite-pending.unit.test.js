// specs/gites-de-france-mail-intake.md rule 18 (audit 2026-10-27) — a mail for a gîte no property is tied
// to yet waits `pending` and is applied once the operator maps the gîte; it used to end in a final
// `error` that no later pass ever looked at again.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { buildModel, TABLE_SQL } = require('../intakesModel');
const { createIntakeService } = require('../intakeService');
const { BOOKING_MAIL } = require('./fixtures');

test('rule 18: unmapped gîte → pending with its reason; mapped later → applied at the next pass', async () => {
  const db = new Database(':memory:');
  db.exec(TABLE_SQL);
  let giteNumbers = { 1: '111111' };
  const R = { id: 5, propertyId: 2, platform: 'GitesDeFrance', kind: 'reservation', sourceType: 'ical', icalSyncLocked: 0, platformGrossAmount: null };
  const updates = [];
  const service = createIntakeService({
    intakes: buildModel(db),
    settings: { mailbox: () => ({ host: 'h', user: 'u', password: 'p' }), sender: () => 's', giteNumbers: () => giteNumbers, autoApply: () => true },
    readMails: async (cfg, h) => { if (!h.seen('<m1>')) await h.onMail({ messageId: '<m1>', receivedAt: '2026-10-14T16:32:00.000Z', text: BOOKING_MAIL, authenticated: true }); },
    findReservations: ({ propertyIds }) => (propertyIds.includes(2) ? [R] : []),
    commissionPercent: () => 10,
    propertyOptions: () => [],
    getReservation: () => ({ ...R, options: [] }),
    core: { updateReservation: (id) => { updates.push(id); return { status: 200 }; }, suggestBeds: () => ({ singleBeds: 0, doubleBeds: 0 }) },
    today: () => '2026-10-20',
  });

  assert.deepEqual(await service.runPass(), { read: 1, pending: 1 });
  assert.deepEqual(db.prepare('SELECT status, error FROM gdf_intakes').get(),
    { status: 'pending', error: 'Aucun logement n’est relié au gîte n°309700' });

  giteNumbers = { 1: '111111', 2: '309700' };
  const second = await service.runPass();
  assert.equal(second.read, 0);
  assert.equal(second.needs_rent || second.applied, 1);
  assert.deepEqual(updates, [5]);
  const row = db.prepare('SELECT status, error, reservationId FROM gdf_intakes').get();
  assert.equal(row.error, null);
  assert.equal(row.reservationId, 5);
});

test('rule 18: mapped but no iCal fiche yet → still pending, the unmapped reason is cleared', async () => {
  const db = new Database(':memory:');
  db.exec(TABLE_SQL);
  let giteNumbers = { 1: '111111' };
  const service = createIntakeService({
    intakes: buildModel(db),
    settings: { mailbox: () => ({ host: 'h', user: 'u', password: 'p' }), sender: () => 's', giteNumbers: () => giteNumbers, autoApply: () => true },
    readMails: async (cfg, h) => { if (!h.seen('<m1>')) await h.onMail({ messageId: '<m1>', receivedAt: '2026-10-14T16:32:00.000Z', text: BOOKING_MAIL, authenticated: true }); },
    findReservations: () => [], commissionPercent: () => 10, propertyOptions: () => [], getReservation: () => null, core: {},
    today: () => '2026-10-20',
  });
  await service.runPass();
  giteNumbers = { 2: '309700' };
  assert.deepEqual(await service.runPass(), { read: 0, pending: 1 });
  assert.deepEqual(db.prepare('SELECT status, error FROM gdf_intakes').get(), { status: 'pending', error: null });
});
