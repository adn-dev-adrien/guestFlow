// specs/gites-de-france-mail-intake.md rule 35 (audit R20, E20-1) — applying a mail keeps the planned moments
// of a planning-card option: its `cardOccurrences` and `cardPersons` reach the core as the fiche's own save
// sends them (`ctx.core.reservations.updateBody`, SDK 2.21.0), on the auto-apply and on « Appliquer ». Real
// in-memory database, real reservations controller, real `ctx.core.reservations.update`, real intake service.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

process.env.DB_PATH = ':memory:';
const f = require('../../../tests/reservationSaveFixture');
const reservationsModel = require('../../../models/reservationsModel');
const optionsModel = require('../../../models/optionsModel');
const core = require('../../sdk/coreServices');
const { buildModel, TABLE_SQL } = require('../intakesModel');
const { createIntakeService } = require('../intakeService');
const { BOOKING_MAIL } = require('./fixtures');

const frDay = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const ARRIVAL = f.inDays(60);
const DEPARTURE = f.inDays(62);
const MOMENTS = [{ date: f.inDays(61), time: '08:30' }];
const MAIL_TEXT = BOOKING_MAIL
  .replace(/arrivee du \d{2}\/\d{2}\/\d{4}/, `arrivee du ${frDay(ARRIVAL)}`)
  .replace(/depart au \d{2}\/\d{2}\/\d{4}/, `depart au ${frDay(DEPARTURE)}`)
  .replace(' et 2 bébés', '');

f.seed();
f.db.prepare('UPDATE properties SET maxGuests = 15, maxBabies = 3, singleBeds = 8, doubleBeds = 4 WHERE id = 1').run();
f.db.prepare("INSERT INTO options (id, title, priceType, price, showsPlanningCard) VALUES (60, 'Petit déjeuner', 'per_person', 10, 1)").run();
f.db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 60)').run();

const cardLine = (id) => f.db.prepare('SELECT quantity, cardOccurrences, cardPersons FROM reservation_options WHERE reservationId = ? AND optionId = 60').get(id);

function stayWithBreakfast({ ical = false } = {}) {
  f.db.prepare('DELETE FROM reservations').run();
  const id = f.createStay({
    startDate: ARRIVAL, endDate: DEPARTURE, platform: 'GitesDeFrance', adults: 8, children: 2, babies: 0,
    options: [{ optionId: 60, quantity: 1, cardOccurrences: MOMENTS, cardPersons: 3 }],
  });
  if (ical) f.db.prepare("UPDATE reservations SET sourceType = 'ical', icalSyncLocked = 0, platformGrossAmount = NULL WHERE id = ?").run(id);
  return id;
}

function serviceFor() {
  const mail = { messageId: `<card-${Math.random()}@gdf07>`, receivedAt: new Date().toISOString(), text: MAIL_TEXT, authenticated: true };
  const idb = new Database(':memory:');
  idb.exec(TABLE_SQL);
  const service = createIntakeService({
    intakes: buildModel(idb),
    settings: {
      mailbox: () => ({ host: 'imap.test', port: 993, user: 'contact@test', password: 'x' }),
      sender: () => 'resa@gdf07.com',
      authentication: () => ({ allowedDomains: 'gdf07.com', trustedAuthservId: 'mx.test' }),
      giteNumbers: () => ({ 1: '309700' }),
      autoApply: () => true,
    },
    readMails: async (cfg, h) => { if (!h.seen(mail.messageId)) await h.onMail(mail); },
    findReservations: ({ propertyIds, startDate, endDate }) => f.db.prepare(`SELECT * FROM reservations WHERE propertyId IN (${propertyIds.map(() => '?').join(',')}) AND startDate = ? AND endDate = ?`).all(...propertyIds, startDate, endDate),
    commissionPercent: () => 10,
    propertyOptions: (pid) => optionsModel.listForProperty(pid),
    getReservation: (rid) => reservationsModel.getByIdWithDetails(rid),
    core: {
      updateReservation: core.reservations.update,
      platformCommission: core.reservations.platformCommission,
      updateBody: core.reservations.updateBody,
      suggestBeds: core.reservations.suggestBeds,
    },
  });
  return { service, intakes: idb };
}

const assertMomentsKept = (id) => {
  const line = cardLine(id);
  assert.equal(line.quantity, 1, 'still one planned moment, not the sold portions');
  assert.deepEqual((JSON.parse(line.cardOccurrences) || []).map(({ date, time }) => ({ date, time })), MOMENTS);
  assert.equal(line.cardPersons, 3);
};
const WRITTEN = ['applied', 'needs_rent'];

test('rule 35: the auto-apply of an untouched iCal placeholder keeps the planned breakfast and its covers', async () => {
  const id = stayWithBreakfast({ ical: true });
  const { service, intakes } = serviceFor();
  await service.runPass();
  const intake = intakes.prepare('SELECT status, error FROM gdf_intakes').get();
  assert.ok(WRITTEN.includes(intake.status), JSON.stringify(intake));
  assertMomentsKept(id);
});

test('rule 35: « Appliquer » on a fiche already touched keeps them too', async () => {
  const id = stayWithBreakfast();
  const { service, intakes } = serviceFor();
  await service.runPass();
  const intake = intakes.prepare('SELECT id, status FROM gdf_intakes').get();
  assert.equal(intake.status, 'proposed');
  service.applyFromBanner(intake.id);
  const after = intakes.prepare('SELECT status, error FROM gdf_intakes WHERE id = ?').get(intake.id);
  assert.ok(WRITTEN.includes(after.status), JSON.stringify(after));
  assertMomentsKept(id);
});
