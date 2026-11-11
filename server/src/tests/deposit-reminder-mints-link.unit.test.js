// specs/payment-link-lifecycle.md rules 35 and 27 — the acompte reminder no longer re-offers whatever
// link is open: its send resolves the acompte link like a request (reused with 24 h left, else a fresh
// one) and states its end; the solde reminder never carries a link. Still sent by hand (Manual).

process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const assert = require('node:assert/strict');

const { emailsFixture, teardown, NOW, HOUR } = require('./paymentLinkEmailsFixture');

test.afterEach(teardown);

test('rule 35 — with no open link, the reminder mints the acompte link at send and carries it with its end', async () => {
  const f = emailsFixture();
  const r = await f.send('deposit_reminder');
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(f.minted, [[f.id, 'deposit']]);
  const link = f.links.findOpenForStay(f.id, 'deposit');
  assert.ok(link, 'a fresh acompte link is open');
  assert.equal(link.expiresAt, '2026-11-03T20:00:00.000Z', '36 h from the send');
  assert.equal(f.sent.length, 1);
  assert.match(f.sent[0].text, new RegExp(`Régler l'acompte en ligne : ${link.url.replace(/[./]/g, '\\$&')}\\nCe lien est valable jusqu'au mardi 3 novembre à 21 h 00\\.`));
  const logged = f.db.prepare('SELECT renderedBody FROM email_log WHERE status = ?').get('sent');
  assert.match(logged.renderedBody, /valable jusqu'au mardi 3 novembre à 21 h 00/, 'the history keeps what left');
});

test('rule 35 — an open link with at least 24 h left is reused, its own end stated', async () => {
  const f = emailsFixture();
  const open = f.openLink({ expiresAt: new Date(NOW.getTime() + 30 * HOUR) });
  const r = await f.send('deposit_reminder');
  assert.equal(r.statusCode, 200);
  assert.equal(f.provider.calls.filter(([c]) => c === 'createLink').length, 0, 'no new link');
  assert.ok(f.sent[0].text.includes(open.url));
  assert.match(f.sent[0].text, /valable jusqu'au mardi 3 novembre à 15 h 00\./);
});

test('rule 35 — an open link with less than 24 h left lapses and the reminder carries a fresh one', async () => {
  const f = emailsFixture();
  const old = f.openLink({ expiresAt: new Date(NOW.getTime() + 20 * HOUR) });
  const r = await f.send('deposit_reminder');
  assert.equal(r.statusCode, 200);
  assert.equal(f.links.findById(old.id).status, 'expired');
  const fresh = f.links.findOpenForStay(f.id, 'deposit');
  assert.notEqual(fresh.id, old.id);
  assert.ok(!f.sent[0].text.includes(old.url), 'the old URL never leaves');
  assert.ok(f.sent[0].text.includes(fresh.url));
});

test('rule 35 — an English-speaking guest reads the end of validity in English', async () => {
  const f = emailsFixture({ lang: 'en' });
  await f.send('deposit_reminder');
  assert.match(f.sent[0].text, /Pay the deposit online: \S+\nThis link is valid until Tuesday 3 November at 9:00 pm\./);
});

test('rule 35 — a link that cannot be minted refuses the reminder: nothing is sent, nothing logged as sent', async () => {
  const f = emailsFixture();
  f.db.prepare('UPDATE reservations SET depositPaid = 1 WHERE id = ?').run(f.id);
  const r = await f.send('deposit_reminder');
  assert.equal(r.statusCode, 409);
  assert.ok(r.body.message, 'the service’s own wording reaches the dialog');
  assert.equal(f.sent.length, 0);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM email_log WHERE status = 'sent'").get().n, 0);
});

test('rule 35 — without a connected provider the reminder leaves without a link, on its « contact us » branch', async () => {
  const f = emailsFixture({ provider: null });
  const r = await f.send('deposit_reminder');
  assert.equal(r.statusCode, 200);
  assert.deepEqual(f.minted, []);
  assert.match(f.sent[0].text, /Contactez-nous pour le règlement\./);
  assert.doesNotMatch(f.sent[0].text, /valable jusqu/);
});

test('rule 35 — a provider declared but not connected re-offers a link that still has 24 h, never mints', async () => {
  const f = emailsFixture({ provider: 'unready' });
  const open = f.openLink();
  const r = await f.send('deposit_reminder');
  assert.equal(r.statusCode, 200);
  assert.deepEqual(f.minted, []);
  assert.ok(f.sent[0].text.includes(open.url));
});

test('rule 27 — the solde reminder never gets a link, even with one open', async () => {
  const f = emailsFixture();
  f.openLink({ type: 'balance' });
  const r = await f.send('balance_reminder');
  assert.equal(r.statusCode, 200);
  assert.deepEqual(f.minted, []);
  assert.match(f.sent[0].text, /Contactez-nous pour le règlement\./);
});

test('rule 35 — the reminder template stays Manual: only its content and its link change', () => {
  const f = emailsFixture();
  const row = f.db.prepare("SELECT sendMode FROM email_templates WHERE stableKey = 'deposit_reminder'").get();
  assert.equal(row.sendMode, 'manual');
});
