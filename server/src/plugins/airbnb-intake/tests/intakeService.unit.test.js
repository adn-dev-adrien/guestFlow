// specs/airbnb-mail-intake.md rules 1–3 and 11–17 — the pass, the matching, the fill and the banner.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { buildModel, TABLE_SQL } = require('../intakesModel');
const { createIntakeService } = require('../intakeService');
const { listingIdOf, detectedFromIcal, listingPairs } = require('../listings');
const { SUBJECT, SENT_AT, bookingMail, WITH_CLEANING } = require('./fixtures');

const PLACEHOLDER = {
  id: 22326, propertyId: 1, platform: 'Airbnb', kind: 'reservation', sourceType: 'ical', icalSyncLocked: 0, platformGrossAmount: null, cancelledAt: null,
};
const CATALOGUE = [
  { id: 7, title: 'Ménage', autoOptionType: 'cleaning', price: 80, autoEnabled: 0 },
  { id: 12, title: 'Lit bébé', autoOptionType: 'baby_bed', price: 5, autoEnabled: 1 },
];
const MAIL = { messageId: '<m1@airbnb>', receivedAt: SENT_AT, sentAt: SENT_AT, subject: SUBJECT, text: bookingMail() };

function setup({
  reservations = [PLACEHOLDER], mails = [MAIL], listings = [[1, '1234567890123456789']],
  autoApply = true, updateStatus = 200, withholds = true, notes = '', dates = ['2026-12-26', '2026-12-30'], now = '2026-10-25T09:00:00.000Z',
} = {}) {
  const db = new Database(':memory:');
  db.exec(TABLE_SQL);
  const intakes = buildModel(db);
  const calls = { updates: [], clients: [] };
  const service = createIntakeService({
    intakes,
    settings: {
      mailbox: () => ({ host: 'imap.test', port: 993, user: 'contact@test', password: 'x' }),
      sender: () => 'automated@airbnb.com',
      listings: () => listings,
      autoApply: () => autoApply,
    },
    readMails: async (cfg) => { calls.readWith = cfg; return mails.map((m) => ({ authenticated: true, ...m })); },
    findReservations: ({ propertyIds, startDate, endDate }) => reservations
      .filter((r) => propertyIds.includes(r.propertyId) && startDate === dates[0] && endDate === dates[1]),
    propertyOptions: () => CATALOGUE,
    getReservation: (id) => ({ ...reservations.find((r) => r.id === id), notes, options: [
      { optionId: 12, quantity: 1, offered: 0, inComplement: 1 },
    ] }),
    core: {
      // Like the core: the client of `opts.client` is found or created with the update (SDK 2.7.0), and only kept on success.
      updateReservation: (id, patch, opts) => {
        const own = opts.client ? { id: 141, ...opts.client } : null;
        if (own && updateStatus === 200) calls.clients.push(opts.client);
        calls.updates.push({ id, patch: own ? { ...patch, clientId: own.id } : patch, opts });
        return { status: updateStatus, clientId: own && updateStatus === 200 ? own.id : undefined, body: updateStatus === 200 ? { ok: true } : { error: 'Séjour commencé ou passé' } };
      },
      suggestBeds: () => ({ singleBeds: 5, doubleBeds: 4 }),
      platformCommission: ({ gross, payout, touristTax }) => Math.round((gross - payout - touristTax) * 100) / 100,
      withholdsTouristTax: () => withholds,
    },
    now: () => new Date(now),
  });
  return { service, intakes, calls };
}

test('rules 1-2: the pass reads the configured sender in the mailbox GuestFlow sends from', async () => {
  const { service, calls } = setup();
  await service.runPass();
  assert.equal(calls.readWith.sender, 'automated@airbnb.com');
  assert.equal(calls.readWith.user, 'contact@test');
});

test('rule 12: an untouched iCal fiche is filled — own client, party, code, message, payment block', async () => {
  const { service, calls } = setup();
  assert.deepEqual(await service.runPass(), { read: 1, applied: 1 });
  assert.deepEqual(calls.clients, [{ firstName: 'Camille', lastName: 'Martin' }]);
  const { id, patch, opts } = calls.updates[0];
  assert.equal(id, 22326);
  assert.equal(opts.label, 'Mail Airbnb du 24/10');
  assert.deepEqual({
    clientId: patch.clientId, reservationNumber: patch.reservationNumber, adults: patch.adults, children: patch.children,
    teens: patch.teens, babies: patch.babies, babyBeds: patch.babyBeds, singleBeds: patch.singleBeds, doubleBeds: patch.doubleBeds,
    platformGrossAmount: patch.platformGrossAmount, platformTouristTaxAmount: patch.platformTouristTaxAmount,
    platformPayoutAmount: patch.platformPayoutAmount, platformCommissionAmount: patch.platformCommissionAmount,
  }, {
    clientId: 141, reservationNumber: 'HMTEST1234', adults: 5, children: 6, teens: 0, babies: 2, babyBeds: 2, singleBeds: 5, doubleBeds: 4,
    platformGrossAmount: 1236.26, platformTouristTaxAmount: 28.86, platformPayoutAmount: 1028.44, platformCommissionAmount: 178.96,
  });
  assert.match(patch.notes, /^Airbnb, 24\/10 :\nBonjour, Nous souhaitons/);
  assert.deepEqual(patch.options, [], 'the auto-enabled cot is left to the engine');
  assert.equal('checkInTime' in patch, false, 'Airbnb prints the listing defaults, not the guest’s times');
});

test('rule 12: the guest message is appended under the existing notes, once', async () => {
  const { service, calls } = setup({ notes: 'Arrivée tardive' });
  await service.runPass();
  assert.match(calls.updates[0].patch.notes, /^Arrivée tardive\n\nAirbnb, 24\/10 :\nBonjour/);
});

test('rule 12: a cleaning fee at the catalogue price ticks the cleaning option, paid to the platform', async () => {
  const mail = { ...MAIL, subject: 'Réservation confirmée : Camille Martin arrive le 9 oct.', text: bookingMail(WITH_CLEANING), sentAt: '2026-09-10T08:00:00.000Z', receivedAt: '2026-09-10T08:00:00.000Z' };
  const { service, calls } = setup({ mails: [mail], dates: ['2026-10-09', '2026-10-11'], now: '2026-09-10T09:00:00.000Z' });
  await service.runPass();
  const { patch } = calls.updates[0];
  assert.deepEqual(patch.options, [{ optionId: 7, quantity: 1, inComplement: 0 }]);
  assert.deepEqual([patch.platformTouristTaxAmount, patch.platformCommissionAmount], [39.87, 124.78]);
});

test('rule 10: outside the `platform` tax mode the withheld box is left empty', async () => {
  const { service, calls } = setup({ withholds: false });
  await service.runPass();
  assert.equal(calls.updates[0].patch.platformTouristTaxAmount, null);
});

test('rule 13: a fiche already edited becomes a proposal, applied only from the banner', async () => {
  const { service, calls } = setup({ reservations: [{ ...PLACEHOLDER, icalSyncLocked: 1 }] });
  assert.deepEqual(await service.runPass(), { read: 1, proposed: 1 });
  assert.equal(calls.updates.length, 0);
  const block = service.blockFor(22326);
  assert.deepEqual([block.status, block.code, block.airbnbUrl], ['proposed', 'HMTEST1234', 'https://www.airbnb.fr/hosting/reservations/details/HMTEST1234']);
  assert.equal(service.applyFromBanner(block.id).status, 'applied');
  assert.equal(calls.updates.length, 1);
});

test('rule 11: no fiche yet → pending, then applied on a later pass', async () => {
  const reservations = [];
  const { service } = setup({ reservations });
  assert.deepEqual(await service.runPass(), { read: 1, pending: 1 });
  reservations.push(PLACEHOLDER);
  assert.deepEqual(await service.runPass(), { read: 0, applied: 1 });
});

test('rule 11: an unmapped listing waits and reaches the dashboard with its id', async () => {
  const { service } = setup({ listings: [[1, '999']], mails: [{ ...MAIL, receivedAt: '2026-10-20T08:00:00.000Z' }] });
  assert.deepEqual(await service.runPass(), { read: 1, pending: 1 });
  assert.equal(service.attention()[0].text, 'Annonce inconnue : Gîte 3* 10 pers., vue, bain nordique, âne, chèvre (1234567890123456789)');
});

test('rule 17: nothing is read before a property is tied to a listing', async () => {
  const { service, calls } = setup({ listings: [] });
  assert.deepEqual(await service.runPass(), { skipped: 'Aucun logement relié à une annonce Airbnb' });
  assert.equal(calls.readWith, undefined);
});

test('rule 17: a refused save (stay started) is recorded as an error', async () => {
  const { service } = setup({ updateStatus: 409 });
  assert.deepEqual(await service.runPass(), { read: 1, error: 1 });
  assert.equal(service.blockFor(22326).error, 'Séjour commencé ou passé');
});

test('edge cases: the same mail twice, and a second mail with the same code', async () => {
  const second = { ...MAIL, messageId: '<m2@airbnb>' };
  const { service, calls } = setup({ mails: [MAIL, MAIL, second] });
  assert.deepEqual(await service.runPass(), { read: 2, applied: 1, ignored: 1 });
  assert.equal(calls.updates.length, 1);
});

test('rule 2: other mails from Airbnb are skipped without a trace', async () => {
  const { service, intakes } = setup({ mails: [{ ...MAIL, subject: 'Nouveau message de Camille', text: 'Bonjour' }] });
  assert.deepEqual(await service.runPass(), { read: 0 });
  assert.equal(intakes.count(), 0);
});

test('rule 3: a booking mail that fails its checks is recorded as an error, nothing written', async () => {
  const { service, calls } = setup({ mails: [{ ...MAIL, text: bookingMail({ payout: '1 028,45 €' }) }] });
  assert.deepEqual(await service.runPass(), { read: 1 });
  assert.equal(calls.updates.length, 0);
  assert.equal(service.attention()[0].text, 'Les montants du versement ne tombent pas juste');
});

test('rule 11: the settings take the listing id or a pasted rooms link', () => {
  assert.equal(listingIdOf('https://www.airbnb.fr/rooms/1398287456607254737?source=x'), '1398287456607254737');
  assert.equal(listingIdOf(' 1398287456607254737 '), '1398287456607254737');
  assert.equal(listingIdOf('Gîte'), '');
});

test('rule 4: the IMAP server is deduced from the sending one (smtp.gmail.com → imap.gmail.com)', () => {
  const { imapHostFor } = require('../../sdk/mailboxReader');
  assert.equal(imapHostFor('smtp.gmail.com'), 'imap.gmail.com');
  assert.equal(imapHostFor('SMTP.ovh.net'), 'imap.ovh.net');
  assert.equal(imapHostFor('mail.example.org'), 'mail.example.org');
  assert.equal(imapHostFor(''), '');
});

test('rule 11: a property with an Airbnb iCal feed needs nothing typed — the id comes from the feed address', () => {
  const sources = [
    { propertyId: 1, url: 'https://www.airbnb.fr/calendar/ical/1398287456607254737.ics?s=secret' },
    { propertyId: 2, url: 'https://www.airbnb.fr/calendar/ical/1576845044615216441.ics?s=secret' },
    { propertyId: 3, url: 'https://www.booking.com/hotel/fr/x.ics' },
  ];
  const detected = detectedFromIcal(sources);
  assert.deepEqual(detected, { 1: ['1398287456607254737'], 2: ['1576845044615216441'] });
  assert.deepEqual(listingPairs({ detected, manual: {} }), [[1, '1398287456607254737'], [2, '1576845044615216441']]);
});

test('rule 11: an override replaces what was detected for that property only, and covers one without a feed', () => {
  const detected = { 1: ['111'], 2: ['222'] };
  const manual = { 1: 'https://www.airbnb.fr/rooms/999', 2: 'n’importe quoi', 3: '333' };
  assert.deepEqual(listingPairs({ detected, manual }), [[1, '999'], [2, '222'], [3, '333']]);
});

test('rule 11: a booking of the property’s second listing is matched too', async () => {
  const other = { ...MAIL, text: bookingMail().replace('1234567890123456789', '5555') };
  const { service, calls } = setup({ listings: [[1, '1234567890123456789'], [1, '5555']], mails: [other] });
  assert.equal((await service.runPass()).applied, 1);
  assert.equal(calls.updates[0].id, 22326);
});
