// specs/booking-extranet-intake.md rules 6 and 12–20 — matching, auto-apply onto an untouched fiche,
// proposal onto a filled one, the refusals, and what is kept.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { buildModel, TABLE_SQL } = require('../intakesModel');
const { createIntakeService } = require('../intakeService');
const { PAGE_6300000001, replaceOnce } = require('./fixtures');

const PLACEHOLDER = {
  id: 22309, kind: 'reservation', propertyId: 1, clientId: 700, platform: 'Lodgify', startDate: '2026-11-06', endDate: '2026-11-08',
  firstName: 'C', lastName: 'G', email: null, phone: null, adults: 1, children: 0, teens: 0, babies: 0,
  platformGrossAmount: null, reservationNumber: '202610123', checkInTime: '15:00', notes: 'Note de l’opérateur',
};
const FILLED = {
  ...PLACEHOLDER, firstName: 'Camille', lastName: 'Garnier', email: 'cgarnier.123456@guest.booking.com', phone: '06 12 34 56 78',
  platform: 'Booking', reservationNumber: '6300000001', adults: 10, checkInTime: '20:00',
  platformGrossAmount: 721.82, platformTouristTaxAmount: 20.02, platformPayoutAmount: 606.44,
  notes: 'Booking, 15/10 :\nEst ce possible d\'avoir 2 lits d\'appoints (nous ne sommes pas certains d\'en avoir besoin)\nDemande de lit d\'appoint: Le client a demandé un lit d\'appoint pour un bébé de adult an.',
};

function setup({ reservation = PLACEHOLDER, rows = [{ id: 22309 }], hotels = { 1: '14407976' }, updateStatus = 200, today = '2026-10-16', shared = () => false, withholds = true } = {}) {
  const db = new Database(':memory:');
  db.exec(TABLE_SQL);
  const intakes = buildModel(db);
  const state = { reservation };
  const calls = { reservation: [], client: [], searches: [], mails: 0 };
  const service = createIntakeService({
    intakes,
    hotelIds: () => hotels,
    today: () => today,
    now: () => new Date(2026, 9, 15, 15, 52),
    findReservations: (q) => { calls.searches.push(q); return rows; },
    getReservation: () => state.reservation,
    clientShared: shared,
    core: {
      // Like the core: the client of `opts.client` is found or created with the update (SDK 2.7.0), and only kept on success.
      updateReservation: (id, patch, opts) => {
        if (updateStatus === 200 && opts.client) calls.found = opts.client;
        calls.reservation.push({ id, patch: opts.client ? { ...patch, clientId: 700 } : patch, opts });
        return updateStatus === 200 ? { status: 200, clientId: 700, body: { ok: true } } : { status: updateStatus, body: { error: 'Capacité dépassée', code: 'CAPACITY' } };
      },
      updateClient: (id, patch) => { calls.client.push({ id, patch }); return { id, ...patch }; },
      suggestBeds: (propertyId, party) => { calls.beds = { propertyId, party }; return { singleBeds: 6, doubleBeds: 4 }; },
      platformCommission: (f) => Math.round((f.gross - f.payout - f.touristTax) * 100) / 100,
      withholdsTouristTax: (propertyId) => { calls.taxProperty = propertyId; return withholds; },
    },
  });
  return { service, intakes, calls, db, state };
}

const page = { hotelId: '14407976', resId: '6300000001', text: PAGE_6300000001 };

test('specs/booking-extranet-intake.md rule 12: the property is the one mapped to the establishment id', () => {
  const { service, calls } = setup();
  service.handlePage(page);
  assert.equal(calls.searches[0].propertyId, 1);
});

test('specs/booking-extranet-intake.md rule 12: an unmapped establishment is refused by name, nothing is written', () => {
  const { service, calls } = setup({ hotels: {} });
  const r = service.handlePage(page);
  assert.equal(r.status, 'refused');
  assert.equal(r.message, 'Établissement Booking 14407976 non relié à un logement');
  assert.deepEqual(calls.reservation, []);
});

test('specs/booking-extranet-intake.md rule 13: the fiche is found by property and exact dates, whatever its canal', () => {
  const { service, calls } = setup();
  service.handlePage(page);
  assert.deepEqual(calls.searches[0], { propertyId: 1, startDate: '2026-11-06', endDate: '2026-11-08' });
  assert.equal(calls.reservation[0].id, 22309);
});

test('specs/booking-extranet-intake.md rule 13: no fiche → refused, asks to retry after the iCal import, creates nothing', () => {
  const { service, calls } = setup({ rows: [] });
  const r = service.handlePage(page);
  assert.equal(r.status, 'refused');
  assert.match(r.message, /Aucune fiche du 06\/11 au 08\/11 : la synchro iCal ne l’a pas encore importée/);
  assert.deepEqual(calls.reservation, []);
});

test('specs/booking-extranet-intake.md rule 14: an untouched placeholder (no gross, no e-mail, no phone) is filled on its own', () => {
  const { service } = setup();
  const r = service.handlePage(page);
  assert.equal(r.status, 'applied');
  assert.equal(r.message, 'GuestFlow : fiche 22309 remplie ✓');
  assert.equal(r.reservationId, 22309);
});

test('specs/booking-extranet-intake.md rule 14: a fiche with a client e-mail is never overwritten silently', () => {
  const { service, calls } = setup({ reservation: { ...PLACEHOLDER, email: 'x@y.fr' } });
  assert.equal(service.handlePage(page).status, 'proposed');
  assert.deepEqual(calls.reservation, []);
});

test('specs/booking-extranet-intake.md rule 14: a fiche whose « Paiement plateforme » is filled is never overwritten silently', () => {
  const { service, calls } = setup({ reservation: { ...PLACEHOLDER, platformGrossAmount: 500 } });
  assert.equal(service.handlePage(page).status, 'proposed');
  assert.deepEqual(calls.reservation, []);
});

test('specs/booking-extranet-intake.md rule 15: applying writes the guest, the party, the number, the arrival time and the four money figures', () => {
  const { service, calls } = setup();
  service.handlePage(page);
  const { patch, opts } = calls.reservation[0];
  assert.deepEqual(
    [patch.platform, patch.reservationNumber, patch.adults, patch.teens, patch.children, patch.babies, patch.checkInTime],
    ['Booking', '6300000001', 10, 0, 0, 0, '20:00'],
  );
  assert.deepEqual(
    [patch.platformGrossAmount, patch.platformTouristTaxAmount, patch.platformPayoutAmount, patch.platformCommissionAmount],
    [721.82, 20.02, 606.44, 95.36],
  );
  assert.deepEqual([patch.singleBeds, patch.doubleBeds], [6, 4]);
  assert.deepEqual(calls.beds, { propertyId: 1, party: { adults: 10, children: 0, teens: 0 } });
  assert.deepEqual(calls.client, [{ id: 700, patch: {
    firstName: 'Camille', lastName: 'Garnier', email: 'cgarnier.123456@guest.booking.com', phone: '+33612345678', emailLanguage: 'fr',
  } }]);
  assert.equal(opts.label, 'Rempli depuis l’extranet Booking (réservation 6300000001)');
});

test('specs/booking-extranet-intake.md rule 15: the guest’s requests are appended under a dated line, the operator’s text stays', () => {
  const { service, calls } = setup();
  service.handlePage(page);
  assert.equal(calls.reservation[0].patch.notes, [
    'Note de l’opérateur',
    '',
    'Booking, 15/10 :',
    "Est ce possible d'avoir 2 lits d'appoints (nous ne sommes pas certains d'en avoir besoin)",
    "Demande de lit d'appoint: Le client a demandé un lit d'appoint pour un bébé de adult an.",
  ].join('\n'));
});

test('specs/booking-extranet-intake.md rule 15: requests already in the notes are not repeated, whatever the capitals', () => {
  const notes = 'Booking, 14/10 :\nest ce possible d\'avoir 2 lits d\'appoints (nous ne sommes pas certains d\'en avoir besoin)\nDemande de lit d\'appoint: Le client a demandé un lit d\'appoint pour un bébé de adult an.';
  const { service, calls } = setup({ reservation: { ...PLACEHOLDER, notes } });
  service.handlePage(page);
  assert.equal(calls.reservation[0].patch.notes, notes);
});

test('specs/booking-extranet-intake.md rule 15: a phone Booking did not give is not written over the client’s, and the toast says so', () => {
  const { service, calls } = setup();
  const r = service.handlePage({ ...page, text: replaceOnce(PAGE_6300000001, '+33 6 12 34 56 78\n', '') });
  assert.equal(r.message, 'GuestFlow : fiche 22309 remplie ✓ (téléphone non communiqué)');
  assert.equal('phone' in calls.client[0].patch, false);
});

test('specs/booking-extranet-intake.md rule 15: the English-speaking guest gets English e-mails', () => {
  const { service, calls } = setup();
  service.handlePage({ ...page, text: replaceOnce(PAGE_6300000001, 'Langue préférée\n\nfrançais', 'Langue préférée\n\nnéerlandais') });
  assert.equal(calls.client[0].patch.emailLanguage, 'en');
});

test('specs/booking-extranet-intake.md rule 16: a stay that has started or passed is refused, nothing written', () => {
  const { service, calls } = setup({ today: '2026-11-06' });
  const r = service.handlePage(page);
  assert.equal(r.status, 'refused');
  assert.equal(r.message, 'Séjour commencé : fiche à saisir à la main');
  assert.deepEqual(calls.reservation, []);
});

test('specs/booking-extranet-intake.md rule 16: when the update service refuses, the reason is shown and the client stays untouched', () => {
  const { service, calls } = setup({ updateStatus: 409 });
  const r = service.handlePage(page);
  assert.equal(r.status, 'refused');
  assert.equal(r.message, 'Capacité dépassée');
  assert.deepEqual(calls.client, []);
});

test('specs/booking-extranet-intake.md rule 17: a fiche already identical to the page is « Déjà à jour » and nothing is written', () => {
  const { service, calls } = setup({ reservation: FILLED });
  const r = service.handlePage(page);
  assert.equal(r.status, 'same');
  assert.equal(r.message, 'GuestFlow : déjà à jour');
  assert.deepEqual(calls.reservation, []);
});

test('specs/booking-extranet-intake.md rule 17: phone formats compare as the same number', () => {
  const { service } = setup({ reservation: { ...FILLED, phone: '+33 6 12 34 56 78' } });
  assert.equal(service.handlePage(page).status, 'same');
});

test('specs/booking-extranet-intake.md rule 17: a filled fiche that differs gets a proposal listing old → new, nothing written', () => {
  const { service, intakes, calls } = setup({ reservation: { ...FILLED, adults: 8, platformPayoutAmount: 600 } });
  const r = service.handlePage(page);
  assert.equal(r.status, 'proposed');
  assert.equal(r.message, 'GuestFlow : fiche déjà remplie, 2 champs diffèrent — à valider dans GuestFlow');
  assert.deepEqual(calls.reservation, []);
  const stored = intakes.latestForReservation(22309);
  assert.deepEqual(stored.parsed.differences.map((d) => [d.field, d.from, d.to]), [['adults', 8, 10], ['platformPayoutAmount', 600, 606.44]]);
});

test('specs/booking-extranet-intake.md rule 17: Appliquer writes Booking’s values, Ignorer drops the proposal', () => {
  const { service, intakes, calls } = setup({ reservation: { ...FILLED, adults: 8 } });
  service.handlePage(page);
  const id = intakes.latestForReservation(22309).id;
  assert.deepEqual(service.applyProposal(id), { status: 'applied' });
  assert.equal(calls.reservation[0].patch.adults, 10);
  assert.equal(intakes.get(id).status, 'applied');

  const second = setup({ reservation: { ...FILLED, adults: 8 } });
  second.service.handlePage(page);
  const proposalId = second.intakes.latestForReservation(22309).id;
  second.service.ignoreProposal(proposalId);
  assert.equal(second.intakes.get(proposalId).status, 'ignored');
  assert.equal(second.intakes.latestForReservation(22309), null);
  assert.deepEqual(second.calls.reservation, []);
});

test('specs/booking-extranet-intake.md rule 18: the banner of an applied intake carries the date and the unanswered guest message', () => {
  const { service } = setup();
  service.handlePage(page);
  const block = service.blockFor(22309);
  assert.equal(block.status, 'applied');
  assert.match(block.appliedLabel, /^\d{2}\/\d{2} à \d{2}:\d{2}$/);
  assert.equal(block.guestMessagePending, false);
});

test('specs/booking-extranet-intake.md rule 18: a later view of the page updates the unanswered-message flag, and Masquer hides the banner', () => {
  const { service, intakes } = setup({ reservation: FILLED });
  service.handlePage(page);
  assert.equal(service.blockFor(22309), null, 'a « same » view alone shows no banner');

  const applied = setup();
  applied.service.handlePage(page);
  applied.state.reservation = FILLED; // what the fiche has become
  const waiting = replaceOnce(PAGE_6300000001, 'Demande acceptée\nEnvoyé\n11h19\n', 'Demande acceptée\nEnvoyé\n11h19\nEt le parking ?\nRépondre\n11h45\n').replace('Aucune réponse requise\n', '');
  applied.service.handlePage({ ...page, text: waiting });
  assert.equal(applied.service.blockFor(22309).guestMessagePending, true);
  applied.service.hide(applied.intakes.latestForReservation(22309).id);
  assert.equal(applied.service.blockFor(22309), null);
  assert.equal(intakes.count(), 1);
});

test('specs/booking-extranet-intake.md rule 19: applying never sends an e-mail — the service has no way to', () => {
  const source = require('fs').readFileSync(require.resolve('../intakeService'), 'utf8');
  assert.doesNotMatch(source, /sendMail|emailService|nodemailer|reservationEmailSender/);
});

test('specs/booking-extranet-intake.md rule 20: every intake is logged — applied, same, proposed and refused with its reason', () => {
  const a = setup();
  a.service.handlePage(page);
  const b = setup({ reservation: FILLED });
  b.service.handlePage(page);
  const c = setup({ reservation: { ...FILLED, adults: 8 } });
  c.service.handlePage(page);
  const d = setup({ hotels: {} });
  d.service.handlePage(page);
  assert.deepEqual([a, b, c, d].map((x) => x.intakes.list(10)[0].status), ['applied', 'same', 'proposed', 'refused']);
  assert.equal(d.intakes.list(10)[0].error, 'Établissement Booking 14407976 non relié à un logement');
});

test('specs/booking-extranet-intake.md rule 20: a refused page keeps no guest data, and no row ever holds the raw text', () => {
  const { service, db } = setup({ hotels: {} });
  service.handlePage(page);
  const rows = db.prepare('SELECT * FROM booking_intakes').all();
  assert.equal(rows[0].parsed, null);
  assert.doesNotMatch(JSON.stringify(db.prepare('SELECT * FROM booking_intakes').all()), /Détails de la réservation|Conversation avec le client/);
  const applied = setup();
  applied.service.handlePage(page);
  const stored = JSON.stringify(applied.db.prepare('SELECT * FROM booking_intakes').all());
  assert.doesNotMatch(stored, /Détails de la réservation|Conversation avec le client|Protégez la sécurité/);
});

test('specs/booking-extranet-intake.md rule 6: the answer carries the toast text — refusal reasons of the parser included', () => {
  const { service } = setup();
  const r = service.handlePage({ ...page, text: replaceOnce(PAGE_6300000001, 'Taxe de séjour\t4.4 %\t€ 20,02', 'Taxe de séjour\t4.4 %\t€ 25,02') });
  assert.equal(r.status, 'refused');
  assert.match(r.message, /Sous-total 701,80 € \+ taxe 25,02 € ≠ total 721,82 €/);
});

test('specs/booking-extranet-intake.md rule 31: Booking reversing the tax to us → nothing withheld, the commission is all of « Commission et frais »', () => {
  const { service, calls } = setup({ withholds: false });
  service.handlePage(page);
  const { patch } = calls.reservation[0];
  assert.equal(calls.taxProperty, 1);
  assert.deepEqual(
    [patch.platformGrossAmount, patch.platformTouristTaxAmount, patch.platformPayoutAmount, patch.platformCommissionAmount],
    [721.82, null, 606.44, 115.38],
  );
});

test('specs/booking-extranet-intake.md rule 31: a fiche filled with a withheld tax Booking no longer keeps gets a proposal to clear it', () => {
  const { service, calls, intakes } = setup({ reservation: FILLED, withholds: false });
  const r = service.handlePage(page);
  assert.equal(r.status, 'proposed');
  assert.deepEqual(calls.reservation, []);
  assert.deepEqual(intakes.latestForReservation(22309).parsed.differences.map((d) => [d.field, d.from, d.to]),
    [['platformTouristTaxAmount', 20.02, null]]);
});

test('specs/booking-extranet-intake.md rule 31: an empty withheld tax on both sides is the same, not a difference', () => {
  const { service } = setup({ reservation: { ...FILLED, platformTouristTaxAmount: null }, withholds: false });
  assert.equal(service.handlePage(page).status, 'same');
});
