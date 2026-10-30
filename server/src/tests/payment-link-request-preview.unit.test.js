// specs/payment-link-lifecycle.md rule 26 (and rule 35's preview) — a request rendered before its send
// never shows a link the send would not carry: an open link with 24 h left is shown with its end, any
// other case prints « (lien de paiement créé à l'envoi) ». A request sent from the e-mail dialog resolves
// its link at send time too.

process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const assert = require('node:assert/strict');

const { emailsFixture, teardown, NOW, HOUR } = require('./paymentLinkEmailsFixture');

test.afterEach(teardown);

const AT_SEND = "(lien de paiement créé à l'envoi)";

test('rule 26 — an open link with 24 h left is previewed as it will leave, with its end', () => {
  const f = emailsFixture();
  const open = f.openLink();
  const r = f.preview('deposit_request');
  assert.equal(r.statusCode, 200);
  assert.ok(r.body.body.includes(`Payer l'acompte en ligne : ${open.url}\nCe lien est valable jusqu'au mardi 3 novembre à 19 h 00.`));
  assert.equal(f.provider.calls.length, 0, 'a preview never calls the provider');
});

test('rule 26 — with less than 24 h left the preview prints the placeholder, not the old URL', () => {
  const f = emailsFixture();
  const old = f.openLink({ expiresAt: new Date(NOW.getTime() + 23 * HOUR) });
  const { body } = f.preview('deposit_request').body;
  assert.ok(body.includes(`Payer l'acompte en ligne : ${AT_SEND}`));
  assert.ok(!body.includes(old.url));
  assert.ok(body.includes("Ce lien est valable jusqu'au (36 h après l'envoi)."));
  assert.equal(f.links.findById(old.id).status, 'open', 'a preview changes nothing');
});

test('rule 26 — a link with no known end, or no link at all, previews as the placeholder', () => {
  const f = emailsFixture();
  f.db.prepare('DELETE FROM payment_links').run();
  assert.ok(f.preview('full_request').body.body.includes(`Payer en ligne : ${AT_SEND}`));
  f.openLink({ type: 'full', expiresAt: null });
  f.db.prepare("UPDATE payment_links SET expiresAt = '0001-01-01T00:00:00Z'").run();
  assert.ok(f.preview('full_request').body.body.includes(`Payer en ligne : ${AT_SEND}`));
});

test('rule 35 — the acompte reminder previews the placeholder inside its link branch', () => {
  const f = emailsFixture();
  const { body } = f.preview('deposit_reminder').body;
  assert.ok(body.includes(`Régler l'acompte en ligne : ${AT_SEND}`));
  assert.doesNotMatch(body, /Contactez-nous/);
});

test('rule 26 — an installment request previews the placeholder once its open link has less than 24 h', () => {
  const f = emailsFixture();
  f.db.prepare("INSERT INTO reservation_installments (id, reservationId, number, dueDate, amountCents) VALUES (41, ?, 1, '2027-06-01', 5000)").run(f.id);
  const open = f.openLink({ type: 'installment', installmentId: 41, amountCents: 5000, expiresAt: new Date(NOW.getTime() + 10 * HOUR) });
  const { body } = f.preview('installment_request', { occurrenceKey: 'installment:41' }).body;
  assert.ok(body.includes(AT_SEND), body);
  assert.ok(!body.includes(open.url));
});

test('rule 26 — an installment request with a link that has 24 h left shows it and its end', () => {
  const f = emailsFixture();
  f.db.prepare("INSERT INTO reservation_installments (id, reservationId, number, dueDate, amountCents) VALUES (41, ?, 1, '2027-06-01', 5000)").run(f.id);
  const open = f.openLink({ type: 'installment', installmentId: 41, amountCents: 5000 });
  const { body } = f.preview('installment_request', { occurrenceKey: 'installment:41' }).body;
  assert.ok(body.includes(`${open.url}\nCe lien est valable jusqu'au mardi 3 novembre à 19 h 00.`), body);
});

test('rule 26 — without a connected provider no placeholder is promised: the no-link branch shows', () => {
  const f = emailsFixture({ provider: null });
  const { body } = f.preview('deposit_reminder').body;
  assert.match(body, /Contactez-nous pour le règlement\./);
  assert.ok(!body.includes(AT_SEND));
});

test('rule 26 — a request sent from the e-mail dialog resolves its link at send time', async () => {
  const f = emailsFixture();
  const old = f.openLink({ type: 'balance', amountCents: 21000, expiresAt: new Date(NOW.getTime() + 5 * HOUR) });
  const r = await f.send('balance_request');
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(f.minted, [[f.id, 'balance']]);
  const fresh = f.links.findOpenForStay(f.id, 'balance');
  assert.notEqual(fresh.id, old.id);
  assert.ok(f.sent[0].text.includes(`Payer le solde en ligne : ${fresh.url}\nCe lien est valable jusqu'au mardi 3 novembre à 21 h 00.`));
  assert.ok(!f.sent[0].text.includes(AT_SEND), 'the placeholder never reaches a guest');
});
