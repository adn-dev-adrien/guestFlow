// specs/booking-extranet-intake.md rules 8–11 — the page text → a booking, or a typed refusal.
const test = require('node:test');
const assert = require('node:assert/strict');

const { parseBookingPage, parseAmount, parseDate } = require('../pageParser');
const { PAGE_6392081711, withBookingWhitespace, replaceOnce } = require('./fixtures');

const parse = (text, resId = '6392081711') => parseBookingPage(text, { resId });

test('specs/booking-extranet-intake.md rule 8: reads dates, party, guest, language, booking number and every amount', () => {
  const { ok, booking } = parse(PAGE_6392081711);
  assert.equal(ok, true);
  assert.equal(booking.resId, '6392081711');
  assert.deepEqual([booking.arrival, booking.departure, booking.nights], ['2026-11-06', '2026-11-08', 2]);
  assert.equal(booking.adults, 10);
  assert.deepEqual(booking.guest, { firstName: 'Camille', lastName: 'Garnier', country: 'fr', email: 'cgarnier.123456@guest.booking.com', phone: '+33612345678' });
  assert.deepEqual(
    [booking.total, booking.commissionable, booking.fees, booking.subtotal, booking.touristTax, booking.payout],
    [721.82, 701.8, 115.38, 701.8, 20.02, 606.44],
  );
  assert.equal(booking.arrivalTime, '20:00');
  assert.equal(booking.emailLanguage, 'fr');
});

test('specs/booking-extranet-intake.md rule 8: the no-break spaces before « : » and the zero-width spaces do not matter', () => {
  const a = parse(withBookingWhitespace(PAGE_6392081711)).booking;
  const b = parse(PAGE_6392081711).booking;
  assert.deepEqual(a, b);
});

test('specs/booking-extranet-intake.md rule 8: the guest’s requests are kept verbatim, the arrival time goes to its own field', () => {
  const { booking } = parse(PAGE_6392081711);
  assert.deepEqual(booking.requests, [
    "Est ce possible d'avoir 2 lits d'appoints (nous ne sommes pas certains d'en avoir besoin)",
    "Demande de lit d'appoint: Le client a demandé un lit d'appoint pour un bébé de adult an.",
  ]);
});

test('specs/booking-extranet-intake.md rule 8: « Identité vérifiée » is stripped from the name, and Booking writes « Prénom Nom »', () => {
  const text = replaceOnce(PAGE_6392081711, 'Camille Garnier\n fr', 'Jean-Pierre Le Garnier Identité vérifiée\n fr');
  assert.deepEqual(
    [parse(text).booking.guest.firstName, parse(text).booking.guest.lastName],
    ['Jean-Pierre', 'Le Garnier'],
  );
});

test('specs/booking-extranet-intake.md rule 8: a phone that was never revealed is empty, not wrong', () => {
  const text = replaceOnce(PAGE_6392081711, '+33 6 12 34 56 78\n', '');
  assert.equal(parse(text).booking.guest.phone, '');
});

test('specs/booking-extranet-intake.md rule 28: a phone printed at the end of Booking’s « Un simple appel suffit » sentence is read', () => {
  const text = replaceOnce(PAGE_6392081711, 'Un simple appel suffit : \n+33 6 12 34 56 78\n', 'Un simple appel suffit : +33 6 12 34 56 78\n');
  assert.equal(parse(text).booking.guest.phone, '+33612345678');
});

test('specs/booking-extranet-intake.md rule 28: a number inside the sentence that is not at its end is not taken for the phone', () => {
  const text = replaceOnce(PAGE_6392081711, 'Un simple appel suffit : \n+33 6 12 34 56 78\n', 'Appelez le +33 6 12 34 56 78 pour plus d’infos.\n');
  assert.equal(parse(text).booking.guest.phone, '');
});

test('specs/booking-extranet-intake.md rule 8: amounts and dates in the extranet’s notation', () => {
  assert.equal(parseAmount('€ 1 283,34'), 1283.34);
  assert.equal(parseAmount('1.283,34 €'), 1283.34);
  assert.equal(parseAmount('€ 115,38 '), 115.38);
  assert.equal(parseAmount('rien'), null);
  assert.equal(parseDate('ven. 6 nov. 2026'), '2026-11-06');
  assert.equal(parseDate('mar. 1 juil. 2026'), '2026-07-01');
  assert.equal(parseDate('lun. 3 août 2026'), '2026-08-03');
  assert.equal(parseDate('vendredi'), null);
});

test('specs/booking-extranet-intake.md rule 8: a guest message still waiting for an answer is detected, an answered one is not', () => {
  assert.equal(parse(PAGE_6392081711).booking.guestMessagePending, false);
  const waiting = replaceOnce(PAGE_6392081711, 'Demande acceptée\nEnvoyé\n11h19\n', 'Demande acceptée\nEnvoyé\n11h19\nMerci, et le parking ?\nRépondre\n11h45\n')
    .replace('Aucune réponse requise\n', '');
  assert.equal(parse(waiting).booking.guestMessagePending, true);
});

test('specs/booking-extranet-intake.md rule 8: a guest who wrote nothing leaves no request and no arrival time', () => {
  const silent = replaceOnce(PAGE_6392081711, 'Informations importantes sur ce client\n\nEst ce possible d’avoir 2 lits d’appoints (nous ne sommes pas certains d’en avoir besoin)\n\nHeure d\'arrivée approximative :\n\nEntre 20:00 et 21:00\n', '')
    .split('Demandes des clients 1')[0];
  const { booking } = parse(silent);
  assert.deepEqual(booking.requests, []);
  assert.equal(booking.arrivalTime, null);
});

test('specs/booking-extranet-intake.md rule 9: the payout is the total minus « Commission et frais » (606,44)', () => {
  assert.equal(parse(PAGE_6392081711).booking.payout, 606.44);
});

test('specs/booking-extranet-intake.md rule 9: nights must equal departure − arrival', () => {
  const r = parse(replaceOnce(PAGE_6392081711, '2 nuits', '3 nuits'));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'NIGHTS_MISMATCH');
});

test('specs/booking-extranet-intake.md rule 9: « Numéro de réservation » must equal the res_id of the address', () => {
  const r = parse(PAGE_6392081711, '6392081712');
  assert.equal(r.code, 'RESERVATION_MISMATCH');
});

test('specs/booking-extranet-intake.md rule 9: Sous-total + Taxe de séjour must equal Montant total, and the message shows the figures', () => {
  const r = parse(replaceOnce(PAGE_6392081711, 'Taxe de séjour\t4.4 %\t€ 20,02', 'Taxe de séjour\t4.4 %\t€ 25,02'));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'TOTAL_MISMATCH');
  assert.match(r.message, /Sous-total 701,80 € \+ taxe 25,02 € ≠ total 721,82 €/);
});

test('specs/booking-extranet-intake.md rule 9: a renamed tax label is « Taxe de séjour introuvable », never a wrong amount', () => {
  const r = parse(replaceOnce(PAGE_6392081711, 'Taxe de séjour\t4.4 %\t€ 20,02', 'Taxe locale\t4.4 %\t€ 20,02'));
  assert.equal(r.code, 'AMOUNT_NOT_FOUND');
  assert.match(r.message, /Taxe de séjour introuvable/);
});

test('specs/booking-extranet-intake.md rule 9: Sous-total must equal « Montant soumis à commission »', () => {
  const r = parse(replaceOnce(PAGE_6392081711, '€ 701,80\n\nReçue', '€ 690,00\n\nReçue'));
  assert.equal(r.code, 'COMMISSIONABLE_MISMATCH');
});

test('specs/booking-extranet-intake.md rule 9: children without their ages are refused rather than guessed', () => {
  const r = parse(replaceOnce(PAGE_6392081711, '10 adultes\n\nNombre d\'hébergements', '8 adultes et 2 enfants\n\nNombre d\'hébergements'));
  assert.equal(r.code, 'AGES_MISSING');
});

test('specs/booking-extranet-intake.md rule 9: two rooms on one reservation are refused', () => {
  const r = parse(replaceOnce(PAGE_6392081711, "Nombre d'hébergements\n\n1", "Nombre d'hébergements\n\n2"));
  assert.equal(r.code, 'MULTIPLE_ROOMS');
});

test('specs/booking-extranet-intake.md rule 9: a reservation cancelled on Booking is refused', () => {
  const r = parse(`${PAGE_6392081711}\nAnnulée\n`);
  assert.equal(r.code, 'CANCELLED');
  assert.match(r.message, /l’annulation passe par la synchro iCal/);
});

test('specs/booking-extranet-intake.md rule 9: any other page is refused as not a reservation', () => {
  assert.equal(parse('Tarifs et disponibilités\nPromotions').code, 'NOT_A_RESERVATION_PAGE');
});

test('specs/booking-extranet-intake.md rule 10: party by GuestFlow’s bands — the 2026-10-06 page, 4 adults and 6 children', () => {
  const text = replaceOnce(PAGE_6392081711, '10 adultes\n\nNombre d\'hébergements', '4 adultes et 6 enfants (3, 6, 8, 10, 15 et 15 ans)\n\nNombre d\'hébergements');
  const { booking } = parse(withBookingWhitespace(text));
  assert.deepEqual([booking.adults, booking.teens, booking.children, booking.babies], [4, 2, 4, 0]);
});

test('specs/booking-extranet-intake.md rule 10: a child under 2 is a baby, 12 is a teen, 11 a child', () => {
  const text = replaceOnce(PAGE_6392081711, '10 adultes\n\nNombre d\'hébergements', '2 adultes et 3 enfants (1, 11 et 12 ans)\n\nNombre d\'hébergements');
  const { booking } = parse(text);
  assert.deepEqual([booking.babies, booking.children, booking.teens], [1, 1, 1]);
});

test('specs/booking-extranet-intake.md rule 11: e-mail language is fr for a French guest, en for everyone else', () => {
  assert.equal(parse(PAGE_6392081711).booking.emailLanguage, 'fr');
  for (const language of ['néerlandais', 'allemand', 'English', 'italien']) {
    assert.equal(parse(replaceOnce(PAGE_6392081711, 'Langue préférée\n\nfrançais', `Langue préférée\n\n${language}`)).booking.emailLanguage, 'en', language);
  }
});
