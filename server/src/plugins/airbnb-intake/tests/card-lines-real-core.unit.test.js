// specs/airbnb-mail-intake.md rule 35 (audit R20, E20-1) — applying a mail keeps the planned moments of a
// planning-card option: its `cardOccurrences` and `cardPersons` reach the core as the fiche's own save sends
// them (`ctx.core.reservations.updateBody`, SDK 2.21.0). Real in-memory database, real reservations
// controller, real `ctx.core.reservations.update`, real intake service.
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
const { subjectFor, bookingMail, NB } = require('./fixtures');

const WEEKDAYS = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
const MONTHS = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];
const mailDay = (iso) => {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]}. ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}.`;
};

const ARRIVAL = f.inDays(60);
const DEPARTURE = f.inDays(64);
const MOMENTS = [{ date: f.inDays(61), time: '08:30' }, { date: f.inDays(62), time: '08:30' }];

f.seed();
f.db.prepare('UPDATE properties SET maxGuests = 15, maxBabies = 3, singleBeds = 8, doubleBeds = 4 WHERE id = 1').run();
f.db.prepare("INSERT INTO options (id, title, priceType, price, showsPlanningCard) VALUES (60, 'Petit déjeuner', 'per_person', 10, 1)").run();
f.db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 60)').run();

const cardLine = (id) => f.db.prepare('SELECT quantity, cardOccurrences, cardPersons FROM reservation_options WHERE reservationId = ? AND optionId = 60').get(id);

function stayWithBreakfast({ ical = false } = {}) {
  f.db.prepare('DELETE FROM reservations').run();
  const id = f.createStay({
    startDate: ARRIVAL, endDate: DEPARTURE, platform: 'Airbnb', adults: 5, children: 6, babies: 0,
    options: [{ optionId: 60, quantity: 2, cardOccurrences: MOMENTS, cardPersons: 3 }],
  });
  if (ical) f.db.prepare("UPDATE reservations SET sourceType = 'ical', icalSyncLocked = 0, platformGrossAmount = NULL WHERE id = ?").run(id);
  return id;
}

function serviceFor() {
  const sentAt = new Date().toISOString();
  const dates = [mailDay(ARRIVAL), mailDay(DEPARTURE)];
  const mail = {
    messageId: `<card-${Math.random()}@airbnb>`, receivedAt: sentAt, sentAt, subject: subjectFor(dates),
    text: bookingMail({ dates, party: `5${NB}adultes, 6${NB}enfants` }), authenticated: true,
  };
  const idb = new Database(':memory:');
  idb.exec(TABLE_SQL);
  const intakes = buildModel(idb);
  const service = createIntakeService({
    intakes,
    settings: { mailbox: () => ({ host: 'imap.test', user: 'u', password: 'p' }), sender: () => 'automated@airbnb.com', listings: () => [[1, '1234567890123456789']], autoApply: () => true },
    readMails: async (cfg, h) => { if (!h.seen(mail.messageId)) await h.onMail(mail); },
    findReservations: ({ propertyIds, startDate, endDate }) => f.db.prepare(`SELECT * FROM reservations WHERE propertyId IN (${propertyIds.map(() => '?').join(',')}) AND startDate = ? AND endDate = ?`).all(...propertyIds, startDate, endDate),
    propertyOptions: (pid) => optionsModel.listForProperty(pid),
    getReservation: (rid) => reservationsModel.getByIdWithDetails(rid),
    core: {
      updateReservation: core.reservations.update,
      updateBody: core.reservations.updateBody,
      suggestBeds: core.reservations.suggestBeds,
      platformCommission: core.reservations.platformCommission,
      withholdsTouristTax: () => true,
    },
  });
  return { service, intakes: idb };
}

const assertMomentsKept = (id) => {
  const line = cardLine(id);
  assert.equal(line.quantity, 2, 'still two planned moments, not the sold portions');
  assert.deepEqual((JSON.parse(line.cardOccurrences) || []).map(({ date, time }) => ({ date, time })), MOMENTS);
  assert.equal(line.cardPersons, 3);
};

test('rule 35: « Appliquer » on a fiche already touched keeps the planned breakfasts and their covers', async () => {
  const id = stayWithBreakfast();
  assertMomentsKept(id);
  const { service, intakes } = serviceFor();
  await service.runPass();
  const intake = intakes.prepare('SELECT id, status FROM airbnb_intakes').get();
  assert.equal(intake.status, 'proposed');
  const result = service.applyFromBanner(intake.id);
  assert.equal(intakes.prepare('SELECT status FROM airbnb_intakes WHERE id = ?').get(intake.id).status, 'applied', JSON.stringify(result));
  assertMomentsKept(id);
});

test('rule 35: the auto-apply of an untouched iCal placeholder keeps them too', async () => {
  const id = stayWithBreakfast({ ical: true });
  const { service, intakes } = serviceFor();
  await service.runPass();
  assert.equal(intakes.prepare('SELECT status FROM airbnb_intakes').get().status, 'applied');
  assertMomentsKept(id);
});
