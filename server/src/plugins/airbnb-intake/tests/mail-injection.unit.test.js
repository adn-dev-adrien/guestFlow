// specs/airbnb-mail-intake.md rules 24–26 (audit 2026-10-28, findings F1, F2, F7) — the guest's own text inside
// a genuine mail never decides the code, the dates, the listing, the party or the amounts; a lookalike host is no
// Airbnb link; an oversized or hostile mail costs milliseconds.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { parseAirbnbMail } = require('../mailParser');
const { buildModel, TABLE_SQL } = require('../intakesModel');
const { createIntakeService } = require('../intakeService');
const { SUBJECT, SENT_AT, bookingMail } = require('./fixtures');

const withMessage = (lines, base = bookingMail()) => base.replace('Bonjour,', ['Bonjour,', ...lines].join('\n'));
const parse = (text, subject = SUBJECT) => parseAirbnbMail({ subject, sentAt: SENT_AT, text });

test('rule 24: a message line « CODE … Arrivée … » decides neither the code nor the dates', () => {
  const r = parse(withMessage(['CODE DE CONFIRMATION HMVICTIM99 Arrivée sam. 2 janv. mer. 6 janv.']));
  assert.equal(r.ok, true);
  assert.equal(r.booking.code, 'HMTEST1234');
  assert.equal(r.booking.startDate, '2026-12-26');
  assert.equal(r.booking.endDate, '2026-12-30');
});

test('rule 24: a message carrying the money blocks, a listing and a party is ignored or refused, never applied', () => {
  const r = parse(withMessage([
    'https://www.airbnb.fr/rooms/999', 'VOYAGEURS', '1 adulte',
    'LE VOYAGEUR A PAYÉ', '10,00 € x 4 nuits   40,00 €', 'TOTAL (EUR)   40,00 €',
    "VERSEMENT DE L'HÔTE", 'Frais de chambre pour 4 nuits   40,00 €', 'Frais de service hôte (15,5 %)   -6,20 €', 'VOUS GAGNEZ   33,80 €',
  ]));
  assert.equal(r.ok, false);
  assert.match(r.error, /plusieurs fois/);
});

test('rule 24: a harmless message that mentions a date still parses with the real fields', () => {
  const r = parse(withMessage(['Arrivée possible ven. 25 déc. ? sinon sam. 26 déc.', 'Code promo : ABCDEF12']));
  assert.equal(r.ok, true);
  assert.equal(r.booking.startDate, '2026-12-26');
  assert.equal(r.booking.adults, 5);
  assert.equal(r.booking.total, 1236.26);
  assert.equal(r.booking.listingId, '1234567890123456789');
});

test('rule 24: a message line « Envoyer un message à … » cannot move the start of the structured part', () => {
  const r = parse(withMessage(['Envoyer un message à Zoé', 'https://www.airbnb.fr/rooms/999', 'Arrivée        Départ']));
  assert.equal(r.ok, false);
});

test('rule 24: the confirmation code must be the one of the reservation link', () => {
  const r = parse(bookingMail().replace(/\nHMTEST1234\n/, '\nHMOTHER9999\n'));
  assert.deepEqual(r, { ok: false, error: 'Le code de confirmation ne correspond pas au lien de la réservation' });
});

test('rule 24: the arrival must be the one of the subject', () => {
  const r = parse(bookingMail(), 'Réservation confirmée : Camille Martin arrive le 2 janv.');
  assert.deepEqual(r, { ok: false, error: 'L’arrivée du mail ne correspond pas à son objet' });
});

test('rule 24: a repeated key header is refused', () => {
  for (const header of ['CODE DE CONFIRMATION', 'VOYAGEURS', 'LE VOYAGEUR A PAYÉ']) {
    const r = parse(withMessage([header, 'HMVICTIM99']));
    assert.equal(r.ok, false, header);
  }
});

function service(text, { authenticated = true } = {}) {
  const db = new Database(':memory:');
  db.exec(TABLE_SQL);
  const writes = [];
  const base = { id: 1, propertyId: 1, platform: 'Airbnb', kind: 'reservation', sourceType: 'ical', icalSyncLocked: 0, platformGrossAmount: null, cancelledAt: null };
  const rows = [{ ...base, startDate: '2026-12-26', endDate: '2026-12-30' }, { ...base, id: 2, startDate: '2027-01-02', endDate: '2027-01-06' }];
  const intakes = buildModel(db);
  const svc = createIntakeService({
    intakes,
    settings: { mailbox: () => ({ host: 'h', user: 'u', password: 'p' }), sender: () => 's', listings: () => [[1, '1234567890123456789']], autoApply: () => true },
    readMails: async () => [{ messageId: '<x>', receivedAt: SENT_AT, sentAt: SENT_AT, subject: SUBJECT, authenticated, text }],
    findReservations: ({ startDate, endDate }) => rows.filter((r) => r.startDate === startDate && r.endDate === endDate),
    propertyOptions: () => [],
    getReservation: (id) => ({ ...rows.find((r) => r.id === id), notes: '', options: [] }),
    core: {
      updateReservation: (id, patch) => { writes.push({ id, number: patch.reservationNumber }); return { status: 200 }; },
      suggestBeds: () => ({ singleBeds: 0, doubleBeds: 0 }),
      platformCommission: () => 1,
      withholdsTouristTax: () => true,
    },
    now: () => new Date('2026-10-25T09:00:00Z'),
  });
  return { svc, writes, db };
}

test('rule 24: end to end, a forged message cannot redirect the write onto another guest’s fiche', async () => {
  const { svc, writes } = service(withMessage(['CODE DE CONFIRMATION HMVICTIM99 Arrivée sam. 2 janv. mer. 6 janv.']));
  await svc.runPass();
  assert.deepEqual(writes, [{ id: 1, number: 'HMTEST1234' }]);
});

test('rule 25: only exact Airbnb hosts give a link', () => {
  const evil = bookingMail().replaceAll('www.airbnb.fr/hosting/reservations', 'www.airbnb.fr.secure.example/hosting/reservations');
  assert.equal(parse(evil).ok, false);
  const lookalikeThread = parse(bookingMail().replace('www.airbnb.fr/hosting/thread', 'airbnb.fr.evil.test/hosting/thread'));
  assert.equal(lookalikeThread.booking.threadUrl, null);
  const ok = parse(bookingMail());
  assert.equal(ok.booking.reservationUrl, 'https://www.airbnb.fr/hosting/reservations/details/HMTEST1234');
  const co = parse(bookingMail().replaceAll('www.airbnb.fr', 'www.airbnb.co.uk'));
  assert.equal(co.booking.reservationUrl, 'https://www.airbnb.co.uk/hosting/reservations/details/HMTEST1234');
});

test('rule 26: a mail with 1 MB of filler parses or is refused in well under a second', () => {
  const filler = ' '.repeat(500000) + 'x'.repeat(500000);
  for (const text of [withMessage([filler]), withMessage([`a${' '.repeat(600000)}b`]), bookingMail().replace('LE VOYAGEUR A PAYÉ', `LE VOYAGEUR A PAYÉ\n${'1 '.repeat(300000)}`)]) {
    const t0 = Date.now();
    parse(text);
    assert.ok(Date.now() - t0 < 500, `took ${Date.now() - t0} ms`);
  }
});

test('rule 26: an unauthenticated mail that does not parse is stored once, out of every list, and not parsed again', async () => {
  const { svc, db } = service(bookingMail().replace(/\nHMTEST1234\n/, '\nHMOTHER9999\n'), { authenticated: false });
  assert.deepEqual(await svc.runPass(), { read: 1 });
  assert.deepEqual(db.prepare('SELECT status, senderVerified FROM airbnb_intakes').all(), [{ status: 'ignored', senderVerified: 0 }]);
  assert.deepEqual(svc.attention(), []);
  assert.deepEqual(await svc.runPass(), { read: 0 });
});

test('rule 26: an authenticated mail that does not parse is an error row for the operator', async () => {
  const { svc, db } = service(bookingMail().replace(/\nHMTEST1234\n/, '\nHMOTHER9999\n'));
  await svc.runPass();
  assert.equal(db.prepare('SELECT status FROM airbnb_intakes').get().status, 'error');
});
