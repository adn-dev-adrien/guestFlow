// specs/gites-de-france-mail-intake.md rule 12 (reading of 2026-11-03, audit R21, E21-1) — « Appliquer » writes once. A
// POST without a rent on an intake already written (second tab, lost response) writes nothing and answers the status;
// a dismissed intake is refused; `proposed` and `error` still run; the rent choice keeps moving the payment block only.
// Real in-memory database, real reservations controller, real `ctx.core.reservations.update`, real intake service.
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
const MAIL_TEXT = BOOKING_MAIL
  .replace(/arrivee du \d{2}\/\d{2}\/\d{4}/, `arrivee du ${frDay(ARRIVAL)}`)
  .replace(/depart au \d{2}\/\d{2}\/\d{4}/, `depart au ${frDay(DEPARTURE)}`)
  .replace(' et 2 bébés', '');
const RENT = 504;
const CUSTOM_LINE = 'Supplément du mail';

f.seed();
f.db.prepare('UPDATE properties SET maxGuests = 15, maxBabies = 3, singleBeds = 8, doubleBeds = 4 WHERE id = 1').run();

async function proposedIntake() {
  f.db.prepare('DELETE FROM reservations').run();
  const id = f.createStay({ startDate: ARRIVAL, endDate: DEPARTURE, platform: 'GitesDeFrance', adults: 8, children: 2, babies: 0, options: [] });
  const mail = { messageId: `<reapply-${Math.random()}@gdf07>`, receivedAt: new Date().toISOString(), text: MAIL_TEXT, authenticated: true };
  const idb = new Database(':memory:');
  idb.exec(TABLE_SQL);
  const service = createIntakeService({
    intakes: buildModel(idb),
    settings: {
      mailbox: () => ({ host: 'imap.test', port: 993, user: 'u', password: 'p' }),
      sender: () => 'resa@gdf07.com',
      authentication: () => ({ allowedDomains: 'gdf07.com', trustedAuthservId: 'mx' }),
      giteNumbers: () => ({ 1: '309700' }),
      autoApply: () => true,
    },
    readMails: async (cfg, h) => { if (!h.seen(mail.messageId)) await h.onMail(mail); },
    findReservations: ({ propertyIds, startDate, endDate }) => f.db.prepare(`SELECT * FROM reservations WHERE propertyId IN (${propertyIds.map(() => '?').join(',')}) AND startDate = ? AND endDate = ?`).all(...propertyIds, startDate, endDate),
    commissionPercent: () => 10,
    propertyOptions: (pid) => optionsModel.listForProperty(pid),
    getReservation: (rid) => reservationsModel.getByIdWithDetails(rid),
    core: { platformCommission: (figures) => require('../../../utils/platformCommission').commissionOf(figures), updateReservation: core.reservations.update, updateBody: core.reservations.updateBody, suggestBeds: core.reservations.suggestBeds },
  });
  await service.runPass();
  const intake = idb.prepare('SELECT id, parsed FROM gdf_intakes').get();
  // A supplement the catalogue does not sell: every application used to add one more custom line.
  const parsed = JSON.parse(intake.parsed);
  idb.prepare('UPDATE gdf_intakes SET parsed = ? WHERE id = ?').run(JSON.stringify({ ...parsed, supplements: [{ label: CUSTOM_LINE, amount: 12 }] }), intake.id);
  const statusOf = () => idb.prepare('SELECT status FROM gdf_intakes WHERE id = ?').get(intake.id).status;
  const set = (sql) => idb.prepare(`UPDATE gdf_intakes SET ${sql} WHERE id = ?`).run(intake.id);
  return { id, service, intakeId: intake.id, statusOf, set };
}

const fiche = (id) => ({
  clientId: f.rowOf(id).clientId,
  adults: f.rowOf(id).adults,
  gross: f.rowOf(id).platformGrossAmount,
  clients: f.db.prepare('SELECT COUNT(*) AS n FROM clients').get().n,
  customLines: f.db.prepare('SELECT COUNT(*) AS n FROM reservation_custom_options WHERE reservationId = ? AND description = ?').get(id, CUSTOM_LINE).n,
  history: f.db.prepare('SELECT COUNT(*) AS n FROM reservation_history WHERE reservationId = ?').get(id).n,
});

test('rule 12: a POST without a rent on an applied intake writes nothing and never goes back to the rent choice', async () => {
  const { id, service, intakeId, statusOf } = await proposedIntake();
  assert.equal(statusOf(), 'proposed');
  assert.deepEqual(service.applyFromBanner(intakeId, { rent: RENT }), { status: 'applied' });
  const first = fiche(id);
  assert.equal(first.customLines, 1);
  assert.notEqual(first.gross, null);

  assert.deepEqual(service.applyFromBanner(intakeId, {}), { status: 'applied' });
  assert.deepEqual(service.applyFromBanner(intakeId), { status: 'applied' });
  assert.deepEqual(fiche(id), first, 'no piled-up line, no history entry');
  assert.equal(statusOf(), 'applied');
});

test('rule 12: a POST without a rent on `needs_rent` writes nothing and answers `needs_rent`, so the stale tab shows the choice', async () => {
  const { id, service, intakeId, statusOf } = await proposedIntake();
  assert.deepEqual(service.applyFromBanner(intakeId), { status: 'needs_rent' });
  const first = fiche(id);
  assert.equal(first.customLines, 1);

  assert.deepEqual(service.applyFromBanner(intakeId), { status: 'needs_rent' });
  assert.deepEqual(fiche(id), first);
  assert.equal(statusOf(), 'needs_rent');
});

test('rule 12: what the operator typed after the first application stays', async () => {
  const { id, service, intakeId } = await proposedIntake();
  service.applyFromBanner(intakeId, { rent: RENT });
  f.db.prepare('UPDATE reservations SET adults = 3 WHERE id = ?').run(id);
  const typed = fiche(id);

  assert.deepEqual(service.applyFromBanner(intakeId), { status: 'applied' });
  assert.deepEqual(fiche(id), typed);
});

test('rule 12: the rent choice still moves the payment block only, once written and with a rent', async () => {
  const { id, service, intakeId, statusOf } = await proposedIntake();
  service.applyFromBanner(intakeId);
  assert.deepEqual(service.applyFromBanner(intakeId, { rent: RENT }), { status: 'applied' });
  const chosen = fiche(id);
  assert.notEqual(chosen.gross, null);
  assert.equal(chosen.customLines, 1);

  f.db.prepare('UPDATE reservations SET adults = 3 WHERE id = ?').run(id);
  assert.deepEqual(service.applyFromBanner(intakeId, { rent: RENT }), { status: 'applied' });
  assert.equal(fiche(id).adults, 3);
  assert.equal(fiche(id).customLines, 1);
  assert.equal(statusOf(), 'applied');
});

test('rule 12: a dismissed intake is refused without a rent; the rent choice stays reachable', async () => {
  const proposed = await proposedIntake();
  const before = fiche(proposed.id);
  proposed.set("dismissedAt = datetime('now')");
  assert.deepEqual(proposed.service.applyFromBanner(proposed.intakeId), { status: 'error', error: 'Saisie ignorée' });
  assert.deepEqual(proposed.service.applyFromBanner(proposed.intakeId, { rent: RENT }), { status: 'error', error: 'Saisie ignorée' });
  assert.deepEqual(fiche(proposed.id), before);
  assert.equal(proposed.statusOf(), 'proposed', 'the refusal leaves the row as it was');

  const applied = await proposedIntake();
  applied.service.applyFromBanner(applied.intakeId, { rent: RENT });
  const written = fiche(applied.id);
  applied.set("dismissedAt = datetime('now')");
  assert.deepEqual(applied.service.applyFromBanner(applied.intakeId), { status: 'error', error: 'Saisie ignorée' });
  assert.deepEqual(fiche(applied.id), written);

  const waiting = await proposedIntake();
  waiting.service.applyFromBanner(waiting.intakeId);
  waiting.set("dismissedAt = datetime('now')");
  assert.deepEqual(waiting.service.applyFromBanner(waiting.intakeId, { rent: RENT }), { status: 'applied' });
});

test('rule 12: an intake in error can still be retried', async () => {
  const { id, service, intakeId, set } = await proposedIntake();
  set("status = 'error', error = 'Erreur 409'");
  assert.deepEqual(service.applyFromBanner(intakeId, { rent: RENT }), { status: 'applied' });
  assert.equal(fiche(id).customLines, 1);
});
