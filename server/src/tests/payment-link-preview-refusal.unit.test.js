// specs/payment-link-lifecycle.md rule 60 (review of #906) — when a request or reminder that carries a link is
// already known to be refused (rule 57 platform stay, rule 55 closed nights, rule 56 unsettled withdrawn payment),
// the preview says so: `refusal: { error, message }`, the same answer the send would give, with no link and no
// placeholder in the text. A template without a link, or a payable stay, carries no refusal.

process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const assert = require('node:assert/strict');

const { emailsFixture, teardown } = require('./paymentLinkEmailsFixture');
const { localIsoDate } = require('../utils/localDate');

test.afterEach(teardown);

const PLACEHOLDER = "(lien de paiement créé à l'envoi)";

test('rule 60: a platform stay — the preview carries the send’s refusal, no link, no placeholder', () => {
  for (const key of ['deposit_request', 'balance_request', 'full_request', 'deposit_reminder']) {
    const f = emailsFixture();
    f.db.prepare('UPDATE reservations SET platform = ? WHERE id = ?').run('Booking', f.id);
    const p = f.preview(key);
    assert.equal(p.statusCode, 200);
    assert.deepEqual(p.body.refusal, { error: 'PLATFORM_RESERVATION', message: 'Réservation plateforme : aucun lien de paiement.' }, key);
    assert.ok(!p.body.body.includes(PLACEHOLDER), key);
    teardown();
  }
});

test('rule 60: closed nights — the preview carries CLOSED_DATES and prints no placeholder', () => {
  const f = emailsFixture();
  const s = f.db.prepare('SELECT propertyId, startDate, endDate FROM reservations WHERE id = ?').get(f.id);
  f.db.prepare('INSERT INTO establishment_closures (propertyId, label, startDate, endDate) VALUES (?, ?, ?, ?)')
    .run(s.propertyId, 'Travaux', s.startDate, s.endDate);
  const p = f.preview('deposit_request');
  assert.equal(p.body.refusal.error, 'CLOSED_DATES');
  assert.equal(p.body.refusal.message, 'Logement fermé sur ces dates : aucun lien créé.');
  assert.ok(!p.body.body.includes(PLACEHOLDER));
});

test('rule 60: a payment received on a withdrawn link, unsettled — the preview carries UNSETTLED_WITHDRAWN_PAYMENT', () => {
  const f = emailsFixture();
  const link = f.openLink({ type: 'deposit' });
  f.db.prepare("UPDATE payment_links SET status = 'cancelled', cancelReason = 'operator', paidAt = ?, providerPaymentId = 'pay_x' WHERE id = ?")
    .run(localIsoDate(new Date()), link.id);
  const p = f.preview('deposit_request');
  assert.equal(p.body.refusal && p.body.refusal.error, 'UNSETTLED_WITHDRAWN_PAYMENT');
});

test('rule 60: a payable direct stay, or a template without a link, carries no refusal', () => {
  const f = emailsFixture();
  assert.equal(f.preview('deposit_request').body.refusal, null);
  f.db.prepare('UPDATE reservations SET platform = ? WHERE id = ?').run('Booking', f.id);
  assert.equal(f.preview('arrival_reminder_7d').body.refusal, null);
});
