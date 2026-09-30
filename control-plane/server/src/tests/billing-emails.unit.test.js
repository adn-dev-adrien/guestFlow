// specs/control-plane-plans-and-access.md rules 17 and 33 — the emails of an invoice: the latest one
// whose day has come, once; prepared for approval in « Manuel », sent in « Automatique »; dropped
// when the invoice is paid or a later email replaces it; « Relancer maintenant » sends at once.

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeContext, makeFakeQonto, NEW_CUSTOMER } = require('./helpers');
const { scheduleOf } = require('../controllers/billingController');

const MONTHLY = { ...NEW_CUSTOMER, billing: 'monthly', length: 1, startsAt: '2026-10-01' }; // ends 2026-11-01

async function setup(customer = MONTHLY) {
  const qonto = makeFakeQonto();
  const h = makeContext({ at: '2026-10-01T08:00:00Z', qonto });
  const c = await h.ctx.controllers.customers.create(customer, 'op');
  h.mailer.sent.length = 0;
  const run = async (iso) => { h.now.set(iso); await h.ctx.controllers.billing.runDaily(() => {}); return h.ctx.controllers.customers.view(c.id); };
  return { ...h, qonto, c, run, billing: h.ctx.controllers.billing };
}

test('rule 17 — the days of each email, monthly and yearly', () => {
  assert.deepEqual(scheduleOf('monthly'), [
    { kind: 'invoice', offset: -7 }, { kind: 'reminder_due', offset: 0 }, { kind: 'reminder_after', offset: 7 },
  ]);
  assert.deepEqual(scheduleOf('yearly').map((s) => [s.kind, s.offset]), [
    ['invoice', -30], ['reminder_before', -7], ['reminder_due', 0], ['reminder_after', 7],
  ]);
});

test('rule 33 — « Manuel »: the email waits, text frozen; a later one replaces it unsent', async () => {
  const s = await setup();
  try {
    let view = await s.run('2026-10-25T08:00:00Z');
    let [queued] = s.billing.queue();
    assert.equal(queued.name, 'Facture');
    assert.equal(queued.companyName, 'Gîte des Aulnes');
    assert.equal(queued.subject, 'Votre facture GuestFlow F-2026-0002');
    assert.match(queued.body, /Payer en ligne : https:\/\/pay\.test\/links\/pl_3/);
    assert.equal(view.emails[0].statusLabel, 'À valider');
    assert.equal(s.mailer.sent.length, 0, 'nothing leaves on its own');

    s.ctx.controllers.templates.save('invoice', { subject: 'Autre objet {{invoiceNumber}}' }, 'op');
    assert.equal(s.billing.queue()[0].subject, 'Votre facture GuestFlow F-2026-0002', 'what was prepared is what will leave');

    await s.run('2026-10-26T08:00:00Z');
    assert.equal(s.billing.queue().length, 1, 'no second email the next day');

    view = await s.run('2026-11-01T08:00:00Z');
    [queued] = s.billing.queue();
    assert.equal(queued.name, 'Relance jour J');
    assert.equal(s.billing.queue().length, 1);
    assert.deepEqual(view.emails.map((e) => [e.name, e.status]), [['Relance jour J', 'pending'], ['Facture', 'dropped']]);
    assert.ok(view.history.some((h) => h.text === 'Email « Facture » retiré de la file sans être envoyé : remplacé par « Relance jour J »'));
  } finally {
    s.cleanup();
  }
});

test('rule 17 — after days without a run, only the latest email is handled', async () => {
  const s = await setup();
  try {
    const view = await s.run('2026-11-09T08:00:00Z');
    assert.deepEqual(view.emails.map((e) => e.name), ['Relance J+7']);
  } finally {
    s.cleanup();
  }
});

test('rule 33 — « Automatique »: the run sends it and journals it', async () => {
  const s = await setup();
  try {
    s.ctx.controllers.templates.save('invoice', { sendMode: 'auto' }, 'op');
    const view = await s.run('2026-10-25T08:00:00Z');
    assert.equal(s.billing.queue().length, 0);
    assert.equal(s.mailer.sent.length, 1);
    assert.equal(s.mailer.sent[0].to, 'claire@aulnes.fr');
    assert.equal(s.mailer.sent[0].subject, 'Votre facture GuestFlow F-2026-0002');
    assert.equal(view.emails[0].statusLabel, 'Envoyé');
    assert.ok(view.history.some((h) => h.text === 'Email « Facture » envoyé à claire@aulnes.fr'));
  } finally {
    s.cleanup();
  }
});

test('rules 17, 33 — send and ignore from the queue; nothing more once the invoice is paid', async () => {
  const s = await setup();
  try {
    await s.run('2026-10-25T08:00:00Z');
    const [first] = s.billing.queue();
    await s.billing.sendQueued(first.id, 'adrien');
    assert.equal(s.mailer.sent.length, 1);
    await assert.rejects(s.billing.sendQueued(first.id, 'adrien'), { status: 409 });

    await s.run('2026-11-01T08:00:00Z');
    const [second] = s.billing.queue();
    s.billing.ignoreQueued(second.id, 'adrien');
    assert.equal(s.billing.queue().length, 0);
    assert.throws(() => s.billing.ignoreQueued(second.id, 'adrien'), { status: 409 });

    s.qonto.pay('pl_3');
    await s.billing.checkPayments(() => {});
    const view = await s.run('2026-11-08T08:00:00Z');
    assert.equal(s.billing.queue().length, 0, 'no J+7 reminder for a paid invoice');
    assert.deepEqual(view.emails.map((e) => e.status), ['ignored', 'sent']);
  } finally {
    s.cleanup();
  }
});

test('rule 17 — a payment drops the email still waiting for approval', async () => {
  const s = await setup();
  try {
    await s.run('2026-10-25T08:00:00Z');
    s.qonto.pay('pl_3');
    await s.billing.checkPayments(() => {});
    assert.equal(s.billing.queue().length, 0);
    assert.equal(s.ctx.controllers.customers.view(s.c.id).emails[0].status, 'dropped');
  } finally {
    s.cleanup();
  }
});

test('rule 17 — « Relancer maintenant »: a preview, then sent at once; refused with no open invoice', async () => {
  const s = await setup();
  try {
    await assert.rejects(s.billing.remind(s.c.id, { preview: true }, 'adrien'), { status: 409, message: 'Aucune facture ouverte à relancer.' });
    await s.run('2026-10-25T08:00:00Z');
    const { preview } = await s.billing.remind(s.c.id, { preview: true }, 'adrien');
    assert.equal(preview.to, 'claire@aulnes.fr');
    assert.equal(preview.subject, 'Relance : facture GuestFlow F-2026-0002');
    assert.equal(s.mailer.sent.length, 0);
    const view = await s.billing.remind(s.c.id, {}, 'adrien');
    assert.equal(s.mailer.sent.length, 1);
    assert.equal(view.emails[0].name, 'Relancer maintenant');
    assert.equal(view.emails[0].operator, 'adrien');
    assert.equal(s.billing.queue().length, 1, 'the scheduled invoice email still waits');
  } finally {
    s.cleanup();
  }
});
