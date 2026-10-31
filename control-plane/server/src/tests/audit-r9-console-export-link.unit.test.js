// specs/hosting-h1-fleet-runtime.md rule 40 and specs/control-plane-plans-and-access.md rule 45 —
// « Réessayer » on a failed closing mail never sends a dead link (audit R9 N1).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { makeContext, NEW_CUSTOMER } = require('./helpers');
const { addDays, frDay, parisDay } = require('../utils/days');

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
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
const mailStep = (h, c) => h.ctx.models.provisioning.get(c.id, 'deprov-email');
const tokenOf = (mail) => (mail.text.match(/\/exports\/([\w-]+)/) || [])[1];
const live = (h, token) => {
  const exp = h.ctx.models.provisioning.getExport(token);
  return Boolean(exp && exp.expiresAt >= today(h) && fs.existsSync(exp.path));
};
const refusedErasing = (err) => err.status === 409 && err.body.error === 'ERASING' && err.body.message === 'Effacement en cours.';

test('rule 40 — the setup: a closing whose mail failed leaves « deprov-email » failed', async () => {
  const { h, c } = await archivedWithFailedMail();
  try {
    assert.equal(mailStep(h, c).status, 'failed');
  } finally { h.cleanup(); }
});

for (const variant of ['queued', 'running']) {
  test(`rule 40 — « Réessayer » the closing mail is refused while an erasure is ${variant}, and no mail leaves`, async () => {
    const { h, c, customers } = await archivedWithFailedMail();
    try {
      let release;
      const gate = new Promise((r) => { release = r; });
      if (variant === 'queued') h.ctx.provisioner.exclusive(c.id, () => gate);
      else {
        const purge = h.host.drivers.backup.purge;
        h.host.drivers.backup.purge = async (...args) => { await gate; return purge.apply(h.host.drivers.backup, args); };
      }
      const before = h.mailer.sent.length;
      const erase = customers.eraseNow(c.id, { confirmSlug: c.slug }, 'op');
      await tick();
      const outcome = await customers.stepAction(c.id, 'deprov-email', 'retry', 'op').then(() => 'accepted', (err) => err);
      release();
      await erase;
      assert.ok(outcome !== 'accepted' && refusedErasing(outcome), `refused with ERASING, got ${outcome && outcome.message}`);
      assert.equal(h.mailer.sent.length, before, 'no mail during the erasure');
    } finally { h.cleanup(); }
  });
}

test('rule 40 — an erasure accepted while the retry waits for the lock: the retry sends nothing', async () => {
  const { h, c, customers } = await archivedWithFailedMail();
  try {
    let release;
    const gate = new Promise((r) => { release = r; });
    h.ctx.provisioner.exclusive(c.id, () => gate);
    const before = h.mailer.sent.length;
    const retry = customers.stepAction(c.id, 'deprov-email', 'retry', 'op');
    await tick();
    const erase = customers.eraseNow(c.id, { confirmSlug: c.slug }, 'op');
    await tick();
    release();
    await retry;
    assert.deepEqual(await erase, { erased: true, id: c.id });
    assert.equal(h.mailer.sent.length, before, 'no link to an archive the erasure deletes next');
  } finally { h.cleanup(); }
});

test('rule 40 — a retry 25 days later writes the link\'s real end date, not « pendant 30 jours »', async () => {
  const { h, c, customers } = await archivedWithFailedMail();
  try {
    const first = h.ctx.models.provisioning.latestExport(c.id);
    later(h, 25);
    await customers.stepAction(c.id, 'deprov-email', 'retry', 'op');
    const mail = h.mailer.sent.at(-1);
    assert.equal(tokenOf(mail), first.token, 'the link is still valid: it is the one sent');
    assert.match(mail.text, new RegExp(`téléchargeable jusqu’au ${frDay(first.expiresAt).replace(/\//g, '\\/')} inclus`));
    assert.doesNotMatch(mail.text, /pendant \d+ jours/);
    assert.equal(mailStep(h, c).status, 'ok');
  } finally { h.cleanup(); }
});

test('rule 40 — the first closing mail also writes the end date', async () => {
  const h = makeContext({ versions: ['3.9.0'] });
  try {
    const { customers, billing } = h.ctx.controllers;
    const c = await customers.create(NEW_CUSTOMER, 'op');
    await billing.deprovision(c.id, { confirmSlug: c.slug }, 'op');
    const mail = h.mailer.sent.at(-1);
    assert.ok(mail.text.includes(`téléchargeable jusqu’au ${frDay(addDays(today(h), 30))} inclus`), mail.text);
  } finally { h.cleanup(); }
});

test('rule 40 — a retry once the link expired and its archive was purged mails a fresh export', async () => {
  const { h, c, customers } = await archivedWithFailedMail();
  try {
    const first = h.ctx.models.provisioning.latestExport(c.id);
    later(h, 52);
    assert.equal(h.ctx.controllers.customers.purgeExpiredExports(), 1);
    assert.equal(live(h, first.token), false);
    await customers.stepAction(c.id, 'deprov-email', 'retry', 'op');
    const mail = h.mailer.sent.at(-1);
    const token = tokenOf(mail);
    assert.notEqual(token, first.token, 'never the dead link');
    assert.equal(live(h, token), true, 'the mailed link downloads');
    assert.equal(h.ctx.models.provisioning.latestExport(c.id).token, token);
    assert.ok(mail.text.includes(`jusqu’au ${frDay(addDays(today(h), 30))} inclus`));
    assert.equal(mailStep(h, c).status, 'ok');
  } finally { h.cleanup(); }
});

test('rule 40 — a retry with a dead link and no database left refuses to mail and says why', async () => {
  const { h, c, customers } = await archivedWithFailedMail();
  try {
    later(h, 52);
    h.ctx.controllers.customers.purgeExpiredExports();
    fs.rmSync(h.ctx.instances.dbPath(c.slug), { force: true });
    const before = h.mailer.sent.length;
    await customers.stepAction(c.id, 'deprov-email', 'retry', 'op');
    assert.equal(h.mailer.sent.length, before, 'no dead link mailed');
    const step = mailStep(h, c);
    assert.deepEqual([step.status, step.detail], ['failed', 'Lien expiré et base introuvable : aucun export à envoyer.']);
  } finally { h.cleanup(); }
});

test('rule 40 — a retry queued behind the lock, then « Réactiver »: no mail and no export', async () => {
  const { h, c, customers } = await archivedWithFailedMail();
  try {
    let release;
    const gate = new Promise((r) => { release = r; });
    h.ctx.provisioner.exclusive(c.id, () => gate);
    later(h, 40);
    const before = h.mailer.sent.length;
    const retry = customers.stepAction(c.id, 'deprov-email', 'retry', 'op');
    await tick();
    const reactivated = customers.reactivate(c.id, 'op');
    await tick();
    release();
    await retry;
    await reactivated;
    await tick(100);
    assert.equal(h.ctx.models.customers.get(c.id).archivedAt, null);
    assert.equal(h.mailer.sent.length, before, 'no « a été fermé » mail to an active customer');
    const archives = h.ctx.models.provisioning.exportsOf(c.id).filter((e) => fs.existsSync(e.path));
    assert.equal(archives.length, 0, 'no export of an active customer');
    assert.equal(mailStep(h, c), null);
    assert.equal(h.ctx.models.provisioning.get(c.id, 'deprov-export'), null);
  } finally { h.cleanup(); }
});

test('rule 40 — two « Réessayer » at once (two tabs) send one mail', async () => {
  const { h, c, customers } = await archivedWithFailedMail();
  try {
    let release;
    const gate = new Promise((r) => { release = r; });
    h.ctx.provisioner.exclusive(c.id, () => gate);
    const before = h.mailer.sent.length;
    await customers.stepAction(c.id, 'deprov-email', 'retry', 'op', { background: true });
    await customers.stepAction(c.id, 'deprov-email', 'retry', 'op', { background: true });
    release();
    await h.ctx.provisioner.exclusive(c.id, async () => {});
    await tick(100);
    assert.equal(h.mailer.sent.length, before + 1);
    assert.equal(mailStep(h, c).status, 'ok');
  } finally { h.cleanup(); }
});

test('rule 40 — the fresh export\'s own token is mailed, even when it shares the old one\'s timestamp', async () => {
  const { h, c, customers } = await archivedWithFailedMail();
  try {
    const first = h.ctx.models.provisioning.latestExport(c.id);
    fs.rmSync(first.path, { force: true });
    await customers.stepAction(c.id, 'deprov-email', 'retry', 'op');
    const token = tokenOf(h.mailer.sent.at(-1));
    assert.notEqual(token, first.token, 'never the link whose archive is gone');
    assert.equal(live(h, token), true, 'the mailed link downloads');
  } finally { h.cleanup(); }
});
