// specs/airbnb-mail-intake.md rules 5–8 — the « Réservation confirmée » mail, read and checked.
const test = require('node:test');
const assert = require('node:assert/strict');

const { parseAirbnbMail, isBookingMail } = require('../mailParser');
const { SUBJECT, subjectFor, SENT_AT, bookingMail, WITH_CLEANING, NB, NNB } = require('./fixtures');

const parse = (overrides, extra = {}) => parseAirbnbMail({ subject: subjectFor(overrides && overrides.dates), text: bookingMail(overrides), sentAt: SENT_AT, ...extra });

test('rule 5: the real layout gives every field', () => {
  const { ok, booking } = parse();
  assert.equal(ok, true);
  assert.deepEqual({
    code: booking.code, firstName: booking.firstName, lastName: booking.lastName,
    listingId: booking.listingId, listingTitle: booking.listingTitle,
    reservationUrl: booking.reservationUrl, threadUrl: booking.threadUrl,
    startDate: booking.startDate, endDate: booking.endDate, checkInTime: booking.checkInTime, checkOutTime: booking.checkOutTime,
    adults: booking.adults, children: booking.children, babies: booking.babies,
  }, {
    code: 'HMTEST1234', firstName: 'Camille', lastName: 'Martin',
    listingId: '1234567890123456789', listingTitle: 'Gîte 3* 10 pers., vue, bain nordique, âne, chèvre',
    reservationUrl: 'https://www.airbnb.fr/hosting/reservations/details/HMTEST1234',
    threadUrl: 'https://www.airbnb.fr/hosting/thread/1111111111',
    startDate: '2026-12-26', endDate: '2026-12-30', checkInTime: '16:00', checkOutTime: '10:00',
    adults: 5, children: 6, babies: 2,
  });
});

test('rule 5: the guest message is joined across the 60-column wrap', () => {
  assert.equal(parse().booking.message,
    'Bonjour, Nous souhaitons passer Noël en famille dans votre beau gite ! Il y aura 5 adultes, 6 enfants et deux bébés. Bien cordialement,');
});

test('rule 5: both money columns, non-breaking spaces included (rule 8)', () => {
  const b = parse().booking;
  assert.deepEqual([b.nights, b.nightlyPrice, b.cleaningFee, b.guestTaxes, b.total, b.hostTaxes, b.roomFees, b.adjustments, b.hostFee, b.hostFeePercent, b.payout],
    [4, 288.65, 0, 81.66, 1236.26, 52.8, 1598, -443.4, 178.96, 15.5, 1028.44]);
});

test('rule 5: a cleaning fee is read in both columns (202609003 figures)', () => {
  const b = parseAirbnbMail({ subject: 'Réservation confirmée : Camille Martin arrive le 9 oct.', text: bookingMail(WITH_CLEANING), sentAt: '2026-09-10T08:00:00.000Z' }).booking;
  assert.deepEqual([b.startDate, b.endDate, b.cleaningFee, b.total, b.hostFee, b.payout, b.adults], ['2026-10-09', '2026-10-11', 80, 868.87, 124.78, 704.22, 10]);
});

test('rule 6: the year comes from the mail date and the printed weekday, across New Year', () => {
  const b = parse({ dates: ['mer. 30 déc.', 'dim. 3 janv.'], guestColumn: [`288,65${NB}€ x 4${NB}nuits   1${NNB}154,60${NB}€`, `Taxes   81,66${NB}€`] }).booking;
  assert.equal(b.startDate, '2026-12-30');
  assert.equal(b.endDate, '2027-01-03');
  const nextYear = parse({ dates: ['ven. 26 févr.', 'mar. 2 mars'] }, { subject: subjectFor(['ven. 26 févr.']), sentAt: '2026-10-24T10:00:00.000Z' });
  assert.equal(nextYear.ok, true);
  assert.equal(nextYear.booking.startDate, '2027-02-26');
});

test('rule 6: no date matching the weekday is refused', () => {
  const r = parse({ dates: ['lun. 26 déc.', 'mer. 30 déc.'] });
  assert.deepEqual(r, { ok: false, error: 'Aucune date ne correspond aux jours du séjour' });
});

test('rule 7: each consistency check refuses the mail instead of guessing', () => {
  assert.equal(parse({ total: `1${NNB}236,27${NB}€` }).error, 'Les montants payés par le voyageur ne tombent pas juste');
  assert.equal(parse({ payout: `1${NNB}028,45${NB}€` }).error, 'Les montants du versement ne tombent pas juste');
  assert.equal(parse({
    hostColumn: [`Taxes   52,80${NB}€`, `Frais de chambre pour 4${NB}nuits   1${NNB}598,00${NB}€`, `Ajustement du tarif par nuit   -443,40${NB}€`, `Frais de service hôte (16,5${NB}%)   -178,96${NB}€`],
  }).error, 'Les frais de service ne font pas 16,5 %');
  assert.equal(parse({ dates: ['sam. 26 déc.', 'jeu. 31 déc.'] }).error, 'Le nombre de nuits ne correspond pas aux dates');
});

test('rule 2: other Airbnb mails are not booking mails', () => {
  assert.equal(isBookingMail('Nouveau message de Camille', 'Bonjour, à quelle heure…'), false);
  assert.equal(isBookingMail('Versement envoyé', 'VOUS GAGNEZ'), false);
  assert.equal(isBookingMail(SUBJECT, bookingMail()), true);
  assert.equal(parseAirbnbMail({ subject: 'Rappel', text: 'x', sentAt: SENT_AT }).ok, false);
});
