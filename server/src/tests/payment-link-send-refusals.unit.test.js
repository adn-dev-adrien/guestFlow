// specs/payment-link-lifecycle.md rule 26 (review of #897) — a request e-mail always carries a valid link:
// without one the request is refused, not mailed with « en ligne : » and an empty end; and a send that
// cannot leave (no address, no SMTP) is refused before a link is minted for it.

process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const assert = require('node:assert/strict');

const { emailsFixture, teardown } = require('./paymentLinkEmailsFixture');

test.afterEach(teardown);

for (const key of ['deposit_request', 'balance_request', 'full_request']) {
  test(`rule 26 — ${key} with no connected provider and no link to reuse is refused, nothing sent`, async () => {
    const f = emailsFixture({ provider: null });
    const r = await f.send(key);
    assert.equal(r.statusCode, 409);
    assert.equal(r.body.error, 'NO_PAYMENT_PROVIDER');
    assert.equal(r.body.message, 'Aucun moyen de paiement en ligne n’est connecté.');
    assert.equal(f.sent.length, 0);
  });
}

test('rule 26 — a provider declared but not connected still sends a request with an open link that has 24 h left', async () => {
  const f = emailsFixture({ provider: 'unready' });
  const open = f.openLink();
  const r = await f.send('deposit_request');
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.ok(f.sent[0].text.includes(open.url));
  assert.deepEqual(f.minted, []);
});

test('rule 26 — the acompte reminder keeps its no-link branch without a provider (not refused)', async () => {
  const f = emailsFixture({ provider: null });
  assert.equal((await f.send('deposit_reminder')).statusCode, 200);
});

test('rule 26 — a guest without an address: refused before any link is minted', async () => {
  const f = emailsFixture();
  f.db.prepare("UPDATE clients SET email = '' WHERE id = 1").run();
  const r = await f.send('deposit_reminder');
  assert.equal(r.statusCode, 404);
  assert.equal(r.body.error, 'CLIENT_NO_EMAIL');
  assert.deepEqual(f.minted, []);
});

test('rule 26 — an invalid typed address: refused before any link is minted', async () => {
  const f = emailsFixture();
  f.db.prepare("UPDATE clients SET email = '' WHERE id = 1").run();
  const r = await f.send('deposit_request', { overrides: { to: 'pas-une-adresse' } });
  assert.equal(r.statusCode, 400);
  assert.deepEqual(f.minted, []);
});

test('rule 26 — SMTP not configured: refused and logged as failed before any link is minted', async () => {
  const f = emailsFixture({ smtp: false });
  const r = await f.send('deposit_request');
  assert.equal(r.statusCode, 409);
  assert.equal(r.body.error, 'EMAIL_NOT_CONFIGURED');
  assert.deepEqual(f.minted, []);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM email_log WHERE status = 'failed'").get().n, 1);
});
