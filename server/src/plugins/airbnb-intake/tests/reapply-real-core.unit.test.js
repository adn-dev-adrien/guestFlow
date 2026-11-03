// specs/airbnb-mail-intake.md rule 14 (reading of 2026-11-03, audit R21, E21-1) — « Appliquer » writes once. A second
// POST on an applied intake (second tab, lost response) writes nothing and answers the status; a dismissed intake is
// refused; `proposed` and `error` still run. Real in-memory database, real reservations controller, real
// `ctx.core.reservations.update`, real intake service.
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
const FEE_LINE = 'Frais de ménage (Airbnb)';

f.seed();
f.db.prepare('UPDATE properties SET maxGuests = 15, maxBabies = 3, singleBeds = 8, doubleBeds = 4 WHERE id = 1').run();

async function proposedIntake({ ical = false } = {}) {
  f.db.prepare('DELETE FROM reservations').run();
  const id = f.createStay({ startDate: ARRIVAL, endDate: DEPARTURE, platform: 'Airbnb', adults: 5, children: 6, babies: 0, options: [] });
  if (ical) f.db.prepare("UPDATE reservations SET sourceType = 'ical', icalSyncLocked = 0, platformGrossAmount = NULL WHERE id = ?").run(id);
  const sentAt = new Date().toISOString();
  const dates = [mailDay(ARRIVAL), mailDay(DEPARTURE)];
  const mail = {
    messageId: `<reapply-${Math.random()}@airbnb>`, receivedAt: sentAt, sentAt, subject: subjectFor(dates),
    text: bookingMail({ dates, party: `5${NB}adultes, 6${NB}enfants` }), authenticated: true,
  };
  const idb = new Database(':memory:');
  idb.exec(TABLE_SQL);
  const service = createIntakeService({
    intakes: buildModel(idb),
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
  await service.runPass();
  const intake = idb.prepare('SELECT id, parsed FROM airbnb_intakes').get();
  // A fee the catalogue does not sell: every application used to add one more custom line.
  const parsed = JSON.parse(intake.parsed);
  idb.prepare('UPDATE airbnb_intakes SET parsed = ? WHERE id = ?').run(JSON.stringify({ ...parsed, cleaningFee: 77 }), intake.id);
  const statusOf = () => idb.prepare('SELECT status FROM airbnb_intakes WHERE id = ?').get(intake.id).status;
  const set = (sql) => idb.prepare(`UPDATE airbnb_intakes SET ${sql} WHERE id = ?`).run(intake.id);
  return { id, service, intakeId: intake.id, statusOf, set };
}

const fiche = (id) => ({
  clientId: f.rowOf(id).clientId,
  adults: f.rowOf(id).adults,
  clients: f.db.prepare('SELECT COUNT(*) AS n FROM clients').get().n,
  feeLines: f.db.prepare('SELECT COUNT(*) AS n FROM reservation_custom_options WHERE reservationId = ? AND description = ?').get(id, FEE_LINE).n,
  history: f.db.prepare('SELECT COUNT(*) AS n FROM reservation_history WHERE reservationId = ?').get(id).n,
});

test('rule 14: a second POST on an applied intake writes nothing and answers « applied »', async () => {
  const { id, service, intakeId, statusOf } = await proposedIntake();
  assert.equal(statusOf(), 'proposed');
  assert.deepEqual(service.applyFromBanner(intakeId), { status: 'applied' });
  const first = fiche(id);
  assert.equal(first.feeLines, 1);

  assert.deepEqual(service.applyFromBanner(intakeId), { status: 'applied' });
  assert.deepEqual(service.applyFromBanner(intakeId), { status: 'applied' });
  assert.deepEqual(fiche(id), first, 'no new client, no piled-up line, no history entry');
  assert.equal(statusOf(), 'applied');
});

test('rule 14: what the operator typed after the first application stays', async () => {
  const { id, service, intakeId } = await proposedIntake();
  service.applyFromBanner(intakeId);
  f.db.prepare('UPDATE reservations SET adults = 3 WHERE id = ?').run(id);
  const typed = fiche(id);

  assert.deepEqual(service.applyFromBanner(intakeId), { status: 'applied' });
  assert.deepEqual(fiche(id), typed);
});

test('rule 14: a mail the auto-apply already wrote is not written again from a stale banner', async () => {
  const { id, service, intakeId, statusOf } = await proposedIntake({ ical: true });
  assert.equal(statusOf(), 'applied', 'the pass still applies an untouched placeholder');
  const first = fiche(id);

  assert.deepEqual(service.applyFromBanner(intakeId), { status: 'applied' });
  assert.deepEqual(fiche(id), first);
});

test('rule 14: a dismissed intake is refused, applied or not', async () => {
  const proposed = await proposedIntake();
  const before = fiche(proposed.id);
  proposed.set("dismissedAt = datetime('now')");
  assert.deepEqual(proposed.service.applyFromBanner(proposed.intakeId), { status: 'error', error: 'Saisie ignorée' });
  assert.deepEqual(fiche(proposed.id), before);
  assert.equal(proposed.statusOf(), 'proposed', 'the refusal leaves the row as it was');

  const applied = await proposedIntake();
  applied.service.applyFromBanner(applied.intakeId);
  const written = fiche(applied.id);
  applied.set("dismissedAt = datetime('now')");
  assert.deepEqual(applied.service.applyFromBanner(applied.intakeId), { status: 'error', error: 'Saisie ignorée' });
  assert.deepEqual(fiche(applied.id), written);
});

test('rule 14: an intake in error can still be retried', async () => {
  const { id, service, intakeId, set } = await proposedIntake();
  set("status = 'error', error = 'Erreur 409'");
  assert.deepEqual(service.applyFromBanner(intakeId), { status: 'applied' });
  assert.equal(fiche(id).feeLines, 1);
});
