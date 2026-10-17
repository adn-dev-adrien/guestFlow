// specs/gites-de-france-mail-intake.md rules 4–7 — reading the booking mail and solving the gross rent.
const test = require('node:test');
const assert = require('node:assert/strict');

const { parseGitesDeFranceMail } = require('../mailParser');
const { rentCandidates } = require('../rentFromNet');
const { BOOKING_MAIL, withTotals } = require('./fixtures');

test('rule 4: the real layout gives every field', () => {
  const r = parseGitesDeFranceMail(BOOKING_MAIL);
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.booking, {
    dossierNumber: '11773',
    giteNumber: '309700',
    startDate: '2026-11-13',
    checkInTime: '16:00',
    endDate: '2026-11-15',
    checkOutTime: '10:00',
    lastName: 'Dupont',
    firstName: 'Claire',
    email: 'claire.dupont@example.org',
    phone: '06 12 34 56 78',
    adults: 8,
    children: 2,
    babies: 2,
    supplements: [{ label: 'Forfait ménage', quantity: 1, times: 1, amount: 80 }],
    netRent: 454,
    optionsTotal: 80,
    totalNet: 534,
    touristTax: 19.2,
  });
});

test('rule 4: line breaks and spacing do not matter (HTML flattened to one line)', () => {
  const r = parseGitesDeFranceMail(BOOKING_MAIL.replace(/\n+/g, ' ').replace(/\t/g, '   '));
  assert.equal(r.ok, true, r.error);
  assert.equal(r.booking.totalNet, 534);
});

test('rule 4: a stay with towels, no children, compound names, thousands', () => {
  const mail = BOOKING_MAIL
    .replace('DUPONT Claire', 'DE LA TOUR Marie-anne')
    .replace('8 adultes, 2 enfants et 2 bébés', '4 adultes')
    .replace('Forfait ménage ( 1 ) x 1\t80.00 €', 'Forfait ménage ( 1 ) x 1\t80.00 €\n5 X Location linge de toilette ( 5 ) x 1\t40.00 €')
    .replace('454.00 €\nTotal des options', '1 612.00 €\nTotal des options')
    .replace('80.00 €\nTotal net', '120.00 €\nTotal net')
    .replace('Total net : 534.00', 'Total net : 1 732.00');
  const r = parseGitesDeFranceMail(mail);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.booking.lastName, 'De La Tour');
  assert.equal(r.booking.firstName, 'Marie-Anne');
  assert.deepEqual([r.booking.adults, r.booking.children, r.booking.babies], [4, 0, 0]);
  assert.equal(r.booking.supplements.length, 2);
  assert.equal(r.booking.supplements[1].amount, 40);
  assert.equal(r.booking.netRent, 1612);
});

test('rule 4: no supplement at all', () => {
  const mail = withTotals(BOOKING_MAIL.replace('Forfait ménage ( 1 ) x 1\t80.00 €', ''), { net: '454.00', options: '0.00', total: '454.00' });
  const r = parseGitesDeFranceMail(mail);
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.booking.supplements, []);
});

test('rule 5: totals that do not add up are refused', () => {
  const r = parseGitesDeFranceMail(BOOKING_MAIL.replace('Total net : 534.00', 'Total net : 540.00'));
  assert.equal(r.ok, false);
  assert.match(r.error, /≠ total net/);
});

test('rule 5: supplements that do not add up to the options total are refused', () => {
  const r = parseGitesDeFranceMail(BOOKING_MAIL.replace('x 1\t80.00 €', 'x 1\t70.00 €'));
  assert.equal(r.ok, false);
  assert.match(r.error, /Suppléments/);
});

test('rule 3: another mail of the centrale, or a missing amount, is refused', () => {
  assert.equal(parseGitesDeFranceMail('Bonjour, votre facture est disponible.').ok, false);
  assert.equal(parseGitesDeFranceMail(BOOKING_MAIL.replace(/une taxe de séjour[^.]*\./, '')).ok, false);
  assert.equal(parseGitesDeFranceMail(BOOKING_MAIL.replace('Réservation confirmée', 'Réservation annulée')).ok, false);
});

test('rule 6: phone normalised from +33 too', () => {
  const r = parseGitesDeFranceMail(BOOKING_MAIL.replace('0612345678', '+33 6 12 34 56 78'));
  assert.equal(r.booking.phone, '06 12 34 56 78');
});

test('rule 7: rent candidates at 10 % — the measured dossiers', () => {
  // ITEA contracts: rent → net (net = rent − round(10 % rent)).
  for (const [rent, net] of [[840, 756], [454, 409], [653, 588], [914, 823], [1791, 1612], [3582, 3224]]) {
    assert.ok(rentCandidates(net, 10).includes(rent), `${net} → ${rent}`);
  }
});

test('rule 7: dossier 11773 is ambiguous (504 or 505), 455 is not', () => {
  assert.deepEqual(rentCandidates(454, 10), [504, 505]);
  assert.deepEqual(rentCandidates(455, 10), [506]);
});

test('rule 7: no rate, or a non-integer net, gives no candidate', () => {
  assert.deepEqual(rentCandidates(454, 0), []);
  assert.deepEqual(rentCandidates(454.5, 10), []);
});
