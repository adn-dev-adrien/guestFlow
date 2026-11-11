// specs/control-plane-plans-and-access.md rule 18 — the operator's daily email: the home page's
// lines, to every operator, and nothing on a quiet day.

const test = require('node:test');
const assert = require('node:assert/strict');
const { passwordHash } = require('../utils/gf');
const { createScheduler } = require('../tasks/scheduler');
const { makeContext, makeFakeQonto, makeInstance, NEW_CUSTOMER } = require('./helpers');

function withOperators(h) {
  makeInstance(h.root, 'aulnes');
  for (const email of ['adrien@adn-dev.fr', 'aide@adn-dev.fr']) {
    h.ctx.models.operators.create({ email, name: '', passwordHash: passwordHash.hashPassword('x-long-password') });
  }
}

test('rule 18 — the day’s lines go to every operator, with the emails to approve', async () => {
  const qonto = makeFakeQonto();
  const h = makeContext({ at: '2026-10-01T08:00:00Z', qonto });
  try {
    withOperators(h);
    await h.ctx.controllers.customers.create({ ...NEW_CUSTOMER, billing: 'monthly', length: 1, startsAt: '2026-10-01' }, 'op');
    h.mailer.sent.length = 0;
    h.now.set('2026-10-25T03:30:00Z');
    const run = await createScheduler(h.ctx, () => {}).tick();
    assert.equal(run.notified, 2);
    const mail = h.mailer.sent.find((m) => m.to === 'adrien@adn-dev.fr');
    assert.equal(mail.subject, 'Console GuestFlow — 25/10/2026 : 2 point(s)');
    assert.equal(mail.text, [
      'À regarder',
      '• Gîte des Aulnes passe aujourd’hui en « À renouveler ».',
      '',
      'Emails à valider (1)',
      '• Gîte des Aulnes : Facture',
      '',
      'Ouvrir la console : https://console.guestflow.test/',
    ].join('\n'));
  } finally {
    h.cleanup();
  }
});

test('rule 18 — a quiet day sends nothing', async () => {
  const h = makeContext({ at: '2026-10-01T08:00:00Z', qonto: makeFakeQonto() });
  try {
    withOperators(h);
    await h.ctx.controllers.customers.create({ ...NEW_CUSTOMER, billing: 'yearly', length: 12, startsAt: '2026-10-01' }, 'op');
    h.mailer.sent.length = 0;
    h.now.set('2026-10-10T02:30:00Z');
    const run = await createScheduler(h.ctx, () => {}).tick();
    assert.equal(run.notified, 0);
    assert.equal(h.mailer.sent.length, 0);
  } finally {
    h.cleanup();
  }
});
