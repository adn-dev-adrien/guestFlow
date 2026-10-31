// specs/payment-link-lifecycle.md rule 57 (audit R9-M1) — a platform stay never carries a direct payment: the mint
// (acompte, solde, séjour, échéance), the request e-mail and the acompte reminder are refused 409
// PLATFORM_RESERVATION « Réservation plateforme : aucun lien de paiement. », before any provider call or mail.

process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const assert = require('node:assert/strict');

const { seedDb, addStay, addLink, fakeProvider, HOUR } = require('./paymentLinkLifecycleFixture');
const { ensurePaymentLink, ensureInstallmentLink, sendPaymentRequest } = require('../utils/paymentRequestService');
const { emailsFixture, teardown, NOW } = require('./paymentLinkEmailsFixture');
const { setDirectChannels } = require('../utils/platformNameFormat');

test.afterEach(() => { teardown(); setDirectChannels([]); });

const MESSAGE = 'Réservation plateforme : aucun lien de paiement.';
const refused = (err) => err.httpStatus === 409 && err.error === 'PLATFORM_RESERVATION' && err.message === MESSAGE;
const PLATFORMS = ['Booking', 'GitesDeFrance', 'Airbnb'];

function setup({ kind = 'reservation', platform = 'Booking' } = {}) {
  const { db, links } = seedDb();
  const id = addStay(db, { kind });
  db.prepare('UPDATE reservations SET platform = ? WHERE id = ?').run(platform, id);
  const provider = fakeProvider();
  const deps = { database: db, paymentLinksModel: links, provider, resolveAmountCents: () => 9000 };
  return { db, links, id, provider, deps };
}

for (const platform of PLATFORMS) {
  test(`rule 57: no acompte, solde or séjour link on a ${platform} stay, before any provider call`, async () => {
    const { links, id, provider, deps } = setup({ platform });
    for (const type of ['deposit', 'balance', 'full']) {
      await assert.rejects(ensurePaymentLink(deps, id, type), refused);
    }
    assert.deepEqual(provider.calls, []);
    assert.deepEqual(links.listForReservation(id), []);
  });
}

test('rule 57: an open link of a platform stay is not handed out again', async () => {
  const { db, links, id, deps } = setup();
  addLink(links, db, id, { type: 'balance', createdAt: new Date(Date.now() - HOUR), expiresAt: new Date(Date.now() + 30 * HOUR) });
  await assert.rejects(ensurePaymentLink(deps, id, 'balance'), refused);
});

test('rule 57: a devis that became a platform reservation is refused too', async () => {
  const { db, id: stayId, provider, deps } = setup();
  const devisId = addStay(db, { kind: 'devis', convertedReservationId: stayId });
  await assert.rejects(ensurePaymentLink(deps, devisId, 'full'), refused);
  assert.deepEqual(provider.calls, []);
});

test('rule 57: the échéance of a platform stay is refused the same way', async () => {
  const { id, provider, deps } = setup();
  const installment = { id: 41, reservationId: id, number: 1, amountCents: 15000, paid: 0 };
  const installmentsModel = { findById: () => installment, listFor: () => [installment] };
  await assert.rejects(ensureInstallmentLink({ ...deps, installmentsModel }, id, 41), refused);
  assert.deepEqual(provider.calls, []);
});

test('rule 57: a direct stay, and a platform counted as a direct sale, still get their link', async () => {
  const direct = setup({ platform: 'direct' });
  assert.equal((await ensurePaymentLink(direct.deps, direct.id, 'full')).reused, false);
  const empty = setup({ platform: null });
  assert.equal((await ensurePaymentLink(empty.deps, empty.id, 'deposit')).reused, false);
  setDirectChannels(['Site Solio']);
  const own = setup({ platform: 'Site Solio' });
  assert.equal((await ensurePaymentLink(own.deps, own.id, 'deposit')).reused, false);
});

test('rule 57: the payment request route (/payment-emails) refuses a platform stay, nothing mailed', async () => {
  const { id, provider, deps } = setup();
  const mails = [];
  await assert.rejects(
    sendPaymentRequest({ ...deps, sendTemplate: async (m) => { mails.push(m); return { sent: true }; } }, id, 'balance'),
    refused,
  );
  assert.deepEqual(provider.calls, []);
  assert.equal(mails.length, 0);
});

for (const key of ['deposit_request', 'balance_request', 'full_request', 'deposit_reminder']) {
  test(`rule 57: ${key} from the e-mail dialog is refused on a platform stay, no link, nothing sent`, async () => {
    const f = emailsFixture({ stay: { depositAmount: 0, balanceAmount: 210 } });
    f.db.prepare('UPDATE reservations SET platform = ? WHERE id = ?').run('Booking', f.id);
    const r = await f.send(key);
    assert.equal(r.statusCode, 409);
    assert.equal(r.body.error, 'PLATFORM_RESERVATION');
    assert.equal(r.body.message, MESSAGE);
    assert.deepEqual(f.minted, []);
    assert.deepEqual(f.provider.calls, []);
    assert.equal(f.sent.length, 0);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM payment_links').get().n, 0);
  });
}

test('rule 57: the refusal holds without a provider (never the « no provider » answer instead)', async () => {
  const f = emailsFixture({ provider: null });
  f.db.prepare('UPDATE reservations SET platform = ? WHERE id = ?').run('Airbnb', f.id);
  const r = await f.send('balance_request');
  assert.equal(r.statusCode, 409);
  assert.equal(r.body.error, 'PLATFORM_RESERVATION');
});

test('rule 57: the preview of a platform stay prints no « created at send » placeholder, nor a stored link', () => {
  const f = emailsFixture({ now: NOW });
  f.db.prepare('UPDATE reservations SET platform = ? WHERE id = ?').run('Booking', f.id);
  const stored = f.openLink({ type: 'balance', amountCents: 21000 });
  const p = f.preview('balance_request');
  assert.equal(p.statusCode, 200);
  assert.ok(!p.body.body.includes("(lien de paiement créé à l'envoi)"), p.body.body);
  assert.ok(!p.body.body.includes(stored.url), p.body.body);
});

test('rule 57: a mail that carries no link (the arrival reminder) still leaves on a platform stay', async () => {
  const f = emailsFixture();
  f.db.prepare('UPDATE reservations SET platform = ? WHERE id = ?').run('Booking', f.id);
  const r = await f.send('arrival_reminder_7d');
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(f.sent.length, 1);
});
