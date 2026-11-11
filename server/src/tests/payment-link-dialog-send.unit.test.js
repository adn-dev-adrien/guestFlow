// specs/payment-link-lifecycle.md rule 26, as read at the review of #897 — the e-mail dialog posts the RENDERED preview as `overrides`. The send puts the link it resolved in place of the
// preview's placeholder or of any older link of the stay, with that link's own end; a placeholder never
// reaches a guest, and a text that lost its link is refused before anything is minted.

process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const assert = require('node:assert/strict');

const { emailsFixture, teardown, NOW, HOUR } = require('./paymentLinkEmailsFixture');

test.afterEach(teardown);

const LINK_AT_SEND = "(lien de paiement créé à l'envoi)";
const VALID_UNTIL_AT_SEND = "(36 h après l'envoi)";
const END = { fr: "Ce lien est valable jusqu'au mardi 3 novembre à 21 h 00.", en: 'This link is valid until Tuesday 3 November at 9:00 pm.' };
const TYPE = { deposit_reminder: 'deposit', deposit_request: 'deposit', balance_request: 'balance', full_request: 'full', installment_request: 'installment' };

function withInstallment(f) {
  f.db.prepare("INSERT INTO reservation_installments (id, reservationId, number, dueDate, amountCents) VALUES (41, ?, 1, '2027-06-01', 5000)").run(f.id);
  return { occurrenceKey: 'installment:41' };
}

async function previewThenSend(f, key, extra = {}) {
  const preview = f.preview(key, extra).body;
  const r = await f.send(key, { ...extra, overrides: { subject: preview.subject, body: preview.body } });
  return { preview, r };
}

const freshOf = (f, key) => (key === 'installment_request' ? f.links.findOpenForInstallment(41) : f.links.findOpenForStay(f.id, TYPE[key]));

for (const lang of ['fr', 'en']) {
  for (const key of Object.keys(TYPE)) {
    test(`rule 26 — ${key} (${lang}): the dialog's preview leaves with the link minted at the send and its end`, async () => {
      const f = emailsFixture({ lang });
      const extra = key === 'installment_request' ? withInstallment(f) : {};
      const { preview, r } = await previewThenSend(f, key, extra);
      assert.ok(preview.body.includes(LINK_AT_SEND), 'the preview showed the placeholder');
      assert.equal(r.statusCode, 200, JSON.stringify(r.body));
      const fresh = freshOf(f, key);
      const text = f.sent[0].text;
      assert.ok(text.includes(`${fresh.url}\n${END[lang]}`), text);
      assert.ok(!text.includes(LINK_AT_SEND) && !text.includes(VALID_UNTIL_AT_SEND), 'no placeholder leaves');
      const logged = f.db.prepare("SELECT renderedBody FROM email_log WHERE status = 'sent'").get();
      assert.equal(logged.renderedBody, text, 'the history keeps what left');
    });
  }
}

test('rule 26 — a stale preview: the link it showed lapsed meanwhile, the guest gets the fresh link, never the old one', async () => {
  const f = emailsFixture();
  const old = f.openLink({ expiresAt: new Date(NOW.getTime() + 24.5 * HOUR) });
  const preview = f.preview('deposit_reminder').body;
  assert.ok(preview.body.includes(old.url));
  assert.ok(preview.body.includes('mardi 3 novembre à 9 h 30'), 'the old end was shown');
  f.setNow(new Date(NOW.getTime() + 1.5 * HOUR)); // the operator sends 90 minutes later: 23 h left
  const r = await f.send('deposit_reminder', { overrides: { subject: preview.subject, body: preview.body } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(f.links.findById(old.id).status, 'expired');
  const fresh = f.links.findOpenForStay(f.id, 'deposit');
  const text = f.sent[0].text;
  assert.ok(!text.includes(old.url), 'a retired URL never leaves');
  assert.ok(!text.includes('mardi 3 novembre à 9 h 30'), 'nor its end');
  assert.ok(text.includes(`${fresh.url}\nCe lien est valable jusqu'au mardi 3 novembre à 22 h 30.`), text);
});

test('rule 26 — an installment preview made without a link (« Contactez-nous ») is refused before any link is minted', async () => {
  const f = emailsFixture();
  const extra = withInstallment(f);
  const r = await f.send('installment_request', { ...extra, overrides: { subject: 'Échéance', body: 'Bonjour,\nContactez-nous pour le règlement.' } });
  assert.equal(r.statusCode, 409);
  assert.equal(r.body.error, 'PAYMENT_LINK_MISSING');
  assert.equal(r.body.message, "Le lien de paiement manque dans le texte : l'e-mail n'est pas envoyé.");
  assert.deepEqual(f.minted, [], 'nothing minted');
  assert.equal(f.sent.length, 0);
});

test('rule 26 — a placeholder that cannot be filled is never sent: refused, nothing mailed, nothing logged as sent', async () => {
  const f = emailsFixture({ provider: null });
  const r = await f.send('deposit_reminder', { overrides: { subject: 'Relance', body: `Régler l'acompte : ${LINK_AT_SEND}\nCe lien est valable jusqu'au ${VALID_UNTIL_AT_SEND}.` } });
  assert.equal(r.statusCode, 409);
  assert.equal(r.body.error, 'PAYMENT_LINK_PLACEHOLDER');
  assert.equal(f.sent.length, 0);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM email_log WHERE status = 'sent'").get().n, 0);
});

test('rule 26 — an operator edit around the link survives the substitution', async () => {
  const f = emailsFixture();
  const preview = f.preview('deposit_request').body;
  const body = preview.body.replace('Bonjour Test,', 'Bonjour Test, merci pour votre message !');
  const r = await f.send('deposit_request', { overrides: { subject: preview.subject, body } });
  assert.equal(r.statusCode, 200);
  assert.ok(f.sent[0].text.startsWith('Bonjour Test, merci pour votre message !'));
  assert.ok(f.sent[0].text.includes(f.links.findOpenForStay(f.id, 'deposit').url));
});
