// specs/hosting-h1-fleet-runtime.md rules 41, 42 and specs/control-plane-plans-and-access.md rule 46 —
// the fresh export of a late « Réessayer » never outlives the erasure, and its failure never marks the
// finished closing as interrupted (audit R10 N1, N2).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { makeContext, NEW_CUSTOMER } = require('./helpers');
const { addDays, frDay, parisDay } = require('../utils/days');

const DAY = 86400000;

async function archivedWithFailedMail() {
  const h = makeContext({ versions: ['3.9.0'] });
  const { customers, billing } = h.ctx.controllers;
  const c = await customers.create(NEW_CUSTOMER, 'op');
  const send = h.mailer.send;
  h.mailer.send = async () => { throw new Error('smtp down'); };
  await billing.deprovision(c.id, { confirmSlug: c.slug }, 'op');
  h.mailer.send = send;
  return { h, c, customers };
}

const later = (h, days) => h.now.set(new Date(h.now().getTime() + days * DAY));
const today = (h) => parisDay(h.now());
const step = (h, c, name) => h.ctx.models.provisioning.get(c.id, name);
const tokenOf = (mail) => (mail.text.match(/\/exports\/([\w-]+)/) || [])[1];
const eraseAtOf = (h, c) => h.ctx.models.customers.get(c.id).eraseAt;

test('rule 41 — a retry on day 80 promises the day before the erasure, and the link answers until then', async () => {
  const { h, c, customers } = await archivedWithFailedMail();
  try {
    const eraseAt = eraseAtOf(h, c);
    later(h, 80);
    await customers.stepAction(c.id, 'deprov-email', 'retry', 'op');
    const mail = h.mailer.sent.at(-1);
    const lastDay = addDays(eraseAt, -1);
    assert.ok(mail.text.includes(`téléchargeable jusqu’au ${frDay(lastDay)} inclus`), mail.text);
    const exp = h.ctx.models.provisioning.getExport(tokenOf(mail));
    assert.equal(exp.expiresAt, lastDay);
    later(h, 9);
    assert.equal(today(h), lastDay);
    assert.equal(fs.existsSync(exp.path), true, 'the archive is there on the promised last day');
    assert.equal(step(h, c, 'deprov-email').status, 'ok');
  } finally { h.cleanup(); }
});

test('rule 41 — a retry on the last day before the erasure promises that same day', async () => {
  const { h, c, customers } = await archivedWithFailedMail();
  try {
    const eraseAt = eraseAtOf(h, c);
    later(h, 89);
    await customers.stepAction(c.id, 'deprov-email', 'retry', 'op');
    const mail = h.mailer.sent.at(-1);
    assert.equal(today(h), addDays(eraseAt, -1));
    assert.ok(mail.text.includes(`téléchargeable jusqu’au ${frDay(today(h))} inclus`), mail.text);
  } finally { h.cleanup(); }
});

test('rule 41 — on the erasure day, before the erasure ran, the retry mails nothing and says why', async () => {
  const { h, c, customers } = await archivedWithFailedMail();
  try {
    const eraseAt = eraseAtOf(h, c);
    later(h, 90);
    const before = h.mailer.sent.length;
    const exportsBefore = h.ctx.models.provisioning.exportsOf(c.id).length;
    await customers.stepAction(c.id, 'deprov-email', 'retry', 'op');
    assert.equal(h.mailer.sent.length, before, 'no link the erasure deletes the same day');
    assert.equal(h.ctx.models.provisioning.exportsOf(c.id).length, exportsBefore, 'no fresh export either');
    const s = step(h, c, 'deprov-email');
    assert.deepEqual([s.status, s.detail], ['failed', `Effacement prévu le ${frDay(eraseAt)} : aucun lien envoyé.`]);
  } finally { h.cleanup(); }
});

const emailAction = (customers, c) => customers.view(c.id).deprovisionSteps.find((s) => s.step === 'deprov-email').action;

test('rule 41 — « Réessayer » is offered until the day before the erasure, never from the erasure day on', async () => {
  const { h, c, customers } = await archivedWithFailedMail();
  try {
    later(h, 89);
    assert.equal(emailAction(customers, c), 'retry', 'the last day before the erasure can still send');
    later(h, 1);
    assert.equal(emailAction(customers, c), null, 'a retry on the erasure day can never succeed');
    await customers.stepAction(c.id, 'deprov-email', 'retry', 'op');
    const s = step(h, c, 'deprov-email');
    assert.equal(s.status, 'failed');
    assert.match(s.detail, /^Effacement prévu le /);
    assert.equal(emailAction(customers, c), null, 'the step keeps its message, without a button');
  } finally { h.cleanup(); }
});

test('rule 41 — past the erasure date (erasure overdue), the message says it is due, not scheduled', async () => {
  const { h, c, customers } = await archivedWithFailedMail();
  try {
    const eraseAt = eraseAtOf(h, c);
    later(h, 92);
    assert.equal(emailAction(customers, c), null);
    await customers.stepAction(c.id, 'deprov-email', 'retry', 'op');
    const s = step(h, c, 'deprov-email');
    assert.deepEqual([s.status, s.detail], ['failed', `Effacement dû le ${frDay(eraseAt)} : aucun lien envoyé.`]);
  } finally { h.cleanup(); }
});

test('rule 41 — with the erasure cancelled, the fresh link keeps its 30 days', async () => {
  const { h, c, customers } = await archivedWithFailedMail();
  try {
    customers.cancelErase(c.id, 'op');
    later(h, 80);
    await customers.stepAction(c.id, 'deprov-email', 'retry', 'op');
    const mail = h.mailer.sent.at(-1);
    assert.ok(mail.text.includes(`téléchargeable jusqu’au ${frDay(addDays(today(h), 30))} inclus`), mail.text);
  } finally { h.cleanup(); }
});

test('rule 42 — a fresh export that fails on retry leaves « Export complet » ok and the closing not interrupted', async () => {
  const { h, c, customers } = await archivedWithFailedMail();
  try {
    const exportRow = step(h, c, 'deprov-export');
    later(h, 40);
    customers.purgeExpiredExports();
    fs.rmSync(h.exportsDir, { recursive: true, force: true });
    fs.writeFileSync(h.exportsDir, 'x');
    await customers.stepAction(c.id, 'deprov-email', 'retry', 'op');
    assert.deepEqual(step(h, c, 'deprov-export'), exportRow, 'the export of the closing is untouched');
    const mail = step(h, c, 'deprov-email');
    assert.equal(mail.status, 'failed');
    assert.match(mail.detail, /^Nouvel export en échec \(.+\) : aucun lien envoyé\.$/);
    const v = customers.view(c.id);
    assert.equal(v.deprovisionSteps.find((s) => s.step === 'deprov-export').action, null, 'no dead « Réessayer »');
    assert.equal(v.deprovisionSteps.find((s) => s.step === 'deprov-email').action, 'retry');
    assert.ok(!v.history.some((x) => x.text.startsWith('Déprovisionnement interrompu')), 'the closing is complete');
    fs.rmSync(h.exportsDir, { force: true });
    await customers.stepAction(c.id, 'deprov-email', 'retry', 'op');
    assert.equal(step(h, c, 'deprov-email').status, 'ok', 'a later retry still recovers');
  } finally { h.cleanup(); }
});
