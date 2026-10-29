// specs/gites-de-france-mail-intake.md rules 1–3 and 7–15 — the pass, the matching, the fill and the banner.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { buildModel, TABLE_SQL } = require('../intakesModel');
const { createIntakeService } = require('../intakeService');
const { BOOKING_MAIL, withTotals } = require('./fixtures');
const { PLACEHOLDER, setup } = require('./serviceFixtures');

test('rules 1-2: the pass reads the sender of the settings in the mailbox GuestFlow sends from', async () => {
  const { service, calls } = setup();
  await service.runPass();
  assert.equal(calls.readWith.sender, 'resa@gdf07.com');
  assert.equal(calls.readWith.user, 'contact@test');
});

test('rule 10: an untouched iCal fiche is filled — guest, party, number, ménage paid to the platform', async () => {
  const { service, calls } = setup({ mails: [{ messageId: '<m1>', receivedAt: '2026-10-14T16:32:00.000Z', text: withTotals(BOOKING_MAIL, { net: '455.00', options: '80.00', total: '535.00' }) }] });
  const result = await service.runPass();
  assert.equal(result.applied, 1);
  const { id, patch, opts } = calls.updates[0];
  assert.equal(id, 22308);
  assert.equal(patch.clientId, 141);
  assert.equal(patch.reservationNumber, '11773');
  assert.deepEqual([patch.adults, patch.children, patch.teens, patch.babies], [8, 2, 0, 2]);
  assert.deepEqual([patch.doubleBeds, patch.singleBeds, patch.babyBeds], [4, 2, 2]);
  assert.deepEqual(patch.options, [{ optionId: 8, quantity: 1, inComplement: 0 }, { optionId: 7, quantity: 1, inComplement: 0 }]);
  assert.deepEqual(patch.offeredOptionIds, [8]);
  assert.match(opts.label, /Mail Gîtes de France du 14\/10/);
  assert.deepEqual(calls.clients[0], { firstName: 'Claire', lastName: 'Dupont', email: 'claire.dupont@example.org', phone: '06 12 34 56 78', emailLanguage: 'fr' });
});

test('rules 7-8: one rent → the payment block lands on the payout (brut = rent + options + tax)', async () => {
  const { service, calls } = setup({ mails: [{ messageId: '<m1>', receivedAt: '2026-10-14T16:32:00.000Z', text: withTotals(BOOKING_MAIL, { net: '455.00', options: '80.00', total: '535.00' }) }] });
  await service.runPass();
  const p = calls.updates[0].patch;
  assert.equal(p.platformGrossAmount, 605.2); // 506 + 80 + 19.20
  assert.equal(p.platformTouristTaxAmount, 19.2);
  assert.equal(p.platformPayoutAmount, 535);
  assert.equal(p.platformCommissionAmount, 51);
  assert.equal(p.platformGrossAmount - p.platformTouristTaxAmount - p.platformCommissionAmount, p.platformPayoutAmount);
});

test('rules 7, 12: two rents (dossier 11773) → filled without the payment, the banner offers 504 / 505', async () => {
  const { service, calls, intakes } = setup();
  const result = await service.runPass();
  assert.equal(result.needs_rent, 1);
  assert.equal(calls.updates[0].patch.platformGrossAmount, undefined);
  const block = service.blockFor(22308);
  assert.equal(block.status, 'needs_rent');
  assert.deepEqual(block.rentCandidates, [{ rent: 504, commission: 50 }, { rent: 505, commission: 51 }]);
  assert.match(block.iteaUrl, /goto=2026_11773_centrale_309700$/);

  const chosen = service.applyFromBanner(block.id, { rent: 504 });
  assert.equal(chosen.status, 'applied');
  assert.deepEqual(calls.updates[1].patch, { platformGrossAmount: 603.2, platformTouristTaxAmount: 19.2, platformPayoutAmount: 534, platformCommissionAmount: 50 });
  assert.equal(intakes.get(block.id).status, 'applied');
  assert.equal(service.applyFromBanner(block.id, { rent: 600 }).status, 'error');
});

test('rule 11: a fiche already edited gets a proposal, never a write', async () => {
  const { service, calls } = setup({ reservations: [{ ...PLACEHOLDER, icalSyncLocked: 1 }] });
  const result = await service.runPass();
  assert.equal(result.proposed, 1);
  assert.equal(calls.updates.length, 0);
  assert.equal(service.blockFor(22308).status, 'proposed');
});

test('rule 4 answer: auto-apply off → always a proposal', async () => {
  const { service, calls } = setup({ autoApply: false });
  assert.equal((await service.runPass()).proposed, 1);
  assert.equal(calls.updates.length, 0);
});

test('rule 9: no fiche yet → pending, applied on a later pass once the iCal created it', async () => {
  const reservations = [];
  const { service, calls } = setup({ reservations });
  assert.equal((await service.runPass()).pending, 1);
  reservations.push(PLACEHOLDER);
  assert.equal((await service.runPass()).needs_rent, 1);
  assert.equal(calls.updates.length, 1);
});

test('rule 18: a gîte number tied to no property waits (pending), shown on the dashboard after a day with its reason', async () => {
  const db = new Database(':memory:');
  db.exec(TABLE_SQL);
  const service = createIntakeService({
    intakes: buildModel(db),
    settings: { mailbox: () => ({ host: 'h', user: 'u', password: 'p' }), sender: () => 's', giteNumbers: () => ({ 2: '400100' }), autoApply: () => true },
    readMails: async () => [{ messageId: '<x>', receivedAt: '2026-10-14T16:32:00.000Z', text: BOOKING_MAIL, authenticated: true }],
    findReservations: () => [], commissionPercent: () => 10, propertyOptions: () => [], getReservation: () => null,
    core: {}, now: () => new Date('2026-10-16T10:00:00Z'),
  });
  assert.equal((await service.runPass()).pending, 1);
  assert.equal(service.attention()[0].status, 'pending');
  assert.match(service.attention()[0].error, /gîte n°309700/);
});

test('rule 16: no property tied to a gîte yet → the mailbox is not even read', async () => {
  let read = false;
  const db = new Database(':memory:');
  db.exec(TABLE_SQL);
  const service = createIntakeService({
    intakes: buildModel(db),
    settings: { mailbox: () => ({ host: 'h', user: 'u', password: 'p' }), sender: () => 's', giteNumbers: () => ({}), autoApply: () => true },
    readMails: async () => { read = true; return []; },
  });
  assert.deepEqual(await service.runPass(), { skipped: 'Aucun logement relié à un numéro de gîte' });
  assert.equal(read, false);
});

test('rule 3: the same Message-ID is read once; a second mail of the same dossier is ignored', async () => {
  const mails = [{ messageId: '<m1>', receivedAt: '2026-10-14T16:32:00.000Z', text: BOOKING_MAIL, authenticated: true }];
  const { service, calls, intakes } = setup({ mails });
  await service.runPass();
  await service.runPass();
  assert.equal(intakes.count(), 1);
  mails.push({ messageId: '<m2>', receivedAt: '2026-10-14T18:00:00.000Z', text: BOOKING_MAIL });
  assert.equal((await service.runPass()).ignored, 1);
  assert.equal(calls.updates.length, 1);
});

test('rule 3: an unreadable booking mail is an error; another mail of the centrale is skipped', async () => {
  const { service, intakes } = setup({ mails: [
    { messageId: '<bad>', receivedAt: '2026-10-14T16:32:00.000Z', text: BOOKING_MAIL.replace('Total net : 534.00', 'Total net : 540.00') },
    { messageId: '<news>', receivedAt: '2026-10-14T16:32:00.000Z', subject: 'Lettre d’information', text: 'Les ateliers 2027 sont ouverts.' },
  ] });
  await service.runPass();
  assert.equal(intakes.count(), 1);
  assert.equal(intakes.get(1).status, 'error');
});

test('rule 7: a platform rate of 0 → error, nothing written', async () => {
  const { service, calls } = setup({ rate: 0 });
  assert.equal((await service.runPass()).error, 1);
  assert.equal(calls.updates.length, 0);
});

test('rule 13: a supplement with no matching catalogue option becomes a line with the centrale’s label and amount', async () => {
  const mail = withTotals(BOOKING_MAIL.replace('Forfait ménage ( 1 ) x 1\t80.00 €', 'Forfait ménage ( 1 ) x 1\t80.00 €\nPanier petit-déjeuner ( 1 ) x 1\t24.00 €'),
    { net: '455.00', options: '104.00', total: '559.00' });
  const { service, calls } = setup({ mails: [{ messageId: '<m1>', receivedAt: '2026-10-14T16:32:00.000Z', text: mail }] });
  await service.runPass();
  assert.deepEqual(calls.updates[0].patch.customOptions, [
    { customKey: 'gdf_11773_2', description: 'Panier petit-déjeuner', amount: 24, offered: false, inComplement: 0 },
  ]);
  assert.deepEqual(service.blockFor(22308).customLines, [{ label: 'Panier petit-déjeuner', amount: 24 }]);
});

test('a refused save is recorded as an error with the core’s message', async () => {
  const { service, intakes } = setup({ updateStatus: 409 });
  await service.runPass();
  assert.equal(intakes.get(1).status, 'error');
  assert.equal(intakes.get(1).error, 'Refusé');
});

test('rule 15: the pass never sends an e-mail (no sender is even injected)', async () => {
  const { service, calls } = setup();
  await service.runPass();
  assert.equal(calls.mailsSent, 0);
});

test('rule 12: a dismissed banner is gone', async () => {
  const { service } = setup();
  await service.runPass();
  service.dismiss(service.blockFor(22308).id);
  assert.equal(service.blockFor(22308), null);
});

test('no mailbox configured → the pass does nothing', async () => {
  const db = new Database(':memory:');
  db.exec(TABLE_SQL);
  const service = createIntakeService({ intakes: buildModel(db), settings: { mailbox: () => ({ host: '', user: '', password: '' }) } });
  assert.deepEqual(await service.runPass(), { skipped: 'Boîte mail non configurée' });
});
