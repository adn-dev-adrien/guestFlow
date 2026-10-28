// specs/gites-de-france-mail-intake.md rules 20–21 — a mail the receiving server did not authenticate is
// never applied on its own; neither is one that would replace the e-mail or phone already on the fiche.
const test = require('node:test');
const assert = require('node:assert/strict');

const { setup, PLACEHOLDER } = require('./serviceFixtures');
const { BOOKING_MAIL, withTotals } = require('./fixtures');

const ONE_RENT = withTotals(BOOKING_MAIL, { net: '455.00', options: '80.00', total: '535.00' });
const mail = (extra = {}) => ({ messageId: '<m1@gdf07>', receivedAt: '2026-10-14T16:32:00.000Z', text: ONE_RENT, ...extra });

test('rule 20: a forged mail (not authenticated) on an untouched fiche becomes a proposal, nothing is written', async () => {
  const { service, intakes, calls } = setup({ mails: [mail({ authenticated: false })] });
  assert.deepEqual(await service.runPass(), { read: 1, proposed: 1 });
  assert.equal(calls.updates.length, 0, 'the fiche is not touched');
  assert.equal(calls.clients.length, 0, 'no client is created from a forged mail');
  assert.equal(intakes.get(1).status, 'proposed');
  assert.equal(intakes.get(1).senderVerified, false);
  assert.equal(service.blockFor(PLACEHOLDER.id).senderUnverified, true);
});

test('rule 20: a mail with no authentication verdict at all is treated as unverified', async () => {
  const { service, calls } = setup({ mails: [mail({ authenticated: undefined })] });
  assert.equal((await service.runPass()).proposed, 1);
  assert.equal(calls.updates.length, 0);
});

test('rule 20: the operator can still apply a proposal from the banner, warning in hand', async () => {
  const { service, intakes, calls } = setup({ mails: [mail({ authenticated: false })] });
  await service.runPass();
  assert.equal(service.applyFromBanner(1).status, 'applied');
  assert.equal(calls.updates.length, 1);
  assert.equal(intakes.get(1).status, 'applied');
});

test('rule 20: a forged proposal does not shadow the genuine mail of the same dossier', async () => {
  const { service, intakes, calls } = setup({ mails: [mail({ messageId: '<forged>', authenticated: false }), mail({ messageId: '<real>', authenticated: true })] });
  assert.deepEqual(await service.runPass(), { read: 2, proposed: 1, applied: 1 });
  assert.equal(intakes.get(2).status, 'applied');
  assert.equal(calls.updates.length, 1);
  assert.equal(service.blockFor(PLACEHOLDER.id).senderUnverified, false, 'the banner shows the genuine intake');
});

test('rule 20: a forged mail that does not parse leaves no row', async () => {
  const { service, intakes } = setup({ mails: [mail({ authenticated: false, text: 'Nouvelle réservation : rien de lisible' })] });
  assert.deepEqual(await service.runPass(), { read: 1 });
  assert.equal(intakes.count(), 0);
});

test('rule 20: an authenticated, untouched fiche is filled as before', async () => {
  const { service, calls } = setup({ mails: [mail({ authenticated: true })] });
  assert.equal((await service.runPass()).applied, 1);
  assert.equal(calls.clients[0].email, 'claire.dupont@example.org');
});

test('rule 21: an authenticated mail never swaps the e-mail or phone already on the fiche — it proposes', async () => {
  for (const contact of [{ email: 'client@real.test' }, { phone: '06 00 00 00 00' }]) {
    const reservations = [{ ...PLACEHOLDER, ...contact }];
    const { service, intakes, calls } = setup({ reservations, mails: [mail({ authenticated: true })] });
    assert.deepEqual(await service.runPass(), { read: 1, proposed: 1 });
    assert.equal(calls.updates.length, 0);
    assert.equal(intakes.get(1).status, 'proposed');
    const block = service.blockFor(PLACEHOLDER.id);
    assert.equal(block.senderUnverified, false);
    assert.equal(block.reason, 'E-mail ou téléphone déjà renseigné sur la fiche');
  }
});

test('rule 21: blank contact fields do not block the fill', async () => {
  const { service, calls } = setup({ reservations: [{ ...PLACEHOLDER, email: ' ', phone: '' }], mails: [mail({ authenticated: true })] });
  assert.equal((await service.runPass()).applied, 1);
  assert.equal(calls.updates.length, 1);
});

test('rule 20: the authentication settings reach the mailbox reader', async () => {
  const { service, calls } = setup({ mails: [] });
  await service.runPass();
  assert.equal(calls.readWith.sender, 'resa@gdf07.com');
  assert.equal(calls.readWith.allowedDomains, 'gdf07.com');
  assert.equal(calls.readWith.trustedAuthservId, 'mx.test');
});
