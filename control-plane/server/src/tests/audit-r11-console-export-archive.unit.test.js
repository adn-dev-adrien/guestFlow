// specs/hosting-h1-fleet-runtime.md rules 43, 44 — an export archive belongs to one link, so a purge
// or a reactivation never deletes the file of a link still valid; and a late « Réessayer » that
// crosses midnight on the eve of the erasure never mails a link already dead (audit R11 N2 and note).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeContext, NEW_CUSTOMER } = require('./helpers');
const session = require('express-session');
const { passwordHash } = require('../utils/gf');
const { createApp } = require('../app');
const { addDays, frDay, parisDay } = require('../utils/days');
const { listenLocal, closeServer, fetchLocal } = require('./listenLocal');

const DAY = 86400000;
const later = (h, days) => h.now.set(new Date(h.now().getTime() + days * DAY));
const today = (h) => parisDay(h.now());
const tokenOf = (mail) => (mail.text.match(/\/exports\/([\w-]+)/) || [])[1];

test('rule 43 — close, reactivate and close again the same day: the live archive survives the next purge', async () => {
  const h = makeContext({ versions: ['3.9.0'] });
  const { customers, billing } = h.ctx.controllers;
  const P = h.ctx.models.provisioning;
  try {
    const c = await customers.create(NEW_CUSTOMER, 'op');
    await billing.deprovision(c.id, { confirmSlug: c.slug }, 'op');
    const first = P.getExport(tokenOf(h.mailer.sent.at(-1)));
    await customers.reactivate(c.id, 'op');
    await billing.deprovision(c.id, { confirmSlug: c.slug }, 'op');
    const second = P.getExport(tokenOf(h.mailer.sent.at(-1)));
    assert.notEqual(second.path, first.path, 'one archive file per export, even on the same day');
    later(h, 1);
    assert.equal(customers.purgeExpiredExports(), 0, 'the first archive went with the reactivation');
    assert.equal(fs.existsSync(second.path), true, 'the link mailed yesterday still has its archive');
    assert.equal(P.getExport(second.token).expiresAt, addDays(today(h), 29));
    assert.ok(!customers.view(c.id).history.some((x) => x.text.startsWith('Archive d’export supprimée')));
  } finally { h.cleanup(); }
});

// Rows written before archive names were unique can share a path: the guard holds for them too.
function sharedPath(h, name) {
  fs.mkdirSync(h.exportsDir, { recursive: true });
  const file = path.join(h.exportsDir, name);
  fs.writeFileSync(file, 'archive');
  return file;
}

test('rule 43 — the daily purge leaves a file that a still valid link points at', async () => {
  const h = makeContext({ versions: ['3.9.0'] });
  const { customers } = h.ctx.controllers;
  const P = h.ctx.models.provisioning;
  try {
    const c = await customers.create(NEW_CUSTOMER, 'op');
    const file = sharedPath(h, 'aulnes-legacy.tar.gz');
    P.addExport({ token: 'old', customerId: c.id, path: file, createdAt: h.now().toISOString(), expiresAt: addDays(today(h), -1) });
    P.addExport({ token: 'live', customerId: c.id, path: file, createdAt: h.now().toISOString(), expiresAt: addDays(today(h), 29) });
    assert.equal(customers.purgeExpiredExports(), 0);
    assert.equal(fs.existsSync(file), true);
    later(h, 30);
    assert.equal(customers.purgeExpiredExports(), 1, 'once every link to it has expired, the file goes');
    assert.equal(fs.existsSync(file), false);
  } finally { h.cleanup(); }
});

test('rule 43 — a reactivation leaves a file that another customer\'s valid link points at', async () => {
  const h = makeContext({ versions: ['3.9.0'] });
  const { customers, billing } = h.ctx.controllers;
  const P = h.ctx.models.provisioning;
  try {
    const a = await customers.create(NEW_CUSTOMER, 'op');
    const b = await customers.create({ ...NEW_CUSTOMER, slug: 'tilleuls', contactEmail: 'contact@tilleuls.test' }, 'op');
    await billing.deprovision(a.id, { confirmSlug: a.slug }, 'op');
    const file = sharedPath(h, 'shared-legacy.tar.gz');
    P.addExport({ token: 'a-legacy', customerId: a.id, path: file, createdAt: h.now().toISOString(), expiresAt: addDays(today(h), 29) });
    P.addExport({ token: 'b-live', customerId: b.id, path: file, createdAt: h.now().toISOString(), expiresAt: addDays(today(h), 29) });
    await customers.reactivate(a.id, 'op');
    assert.equal(P.getExport('a-legacy').expiresAt, addDays(today(h), -1), 'the customer\'s own links still expire');
    assert.equal(fs.existsSync(file), true, 'the other customer\'s link keeps its archive');
  } finally { h.cleanup(); }
});

test('rule 44 — a retry on the eve of the erasure whose export ends past midnight mails no dead link', async () => {
  const h = makeContext({ versions: ['3.9.0'] });
  const { customers, billing } = h.ctx.controllers;
  try {
    const c = await customers.create(NEW_CUSTOMER, 'op');
    const send = h.mailer.send;
    h.mailer.send = async () => { throw new Error('smtp down'); };
    await billing.deprovision(c.id, { confirmSlug: c.slug }, 'op');
    h.mailer.send = send;
    const { eraseAt } = h.ctx.models.customers.get(c.id);
    const P = h.ctx.models.provisioning;
    const earlier = P.latestExport(c.id);
    const exportStep = P.get(c.id, 'deprov-export');
    later(h, 89);
    assert.equal(today(h), addDays(eraseAt, -1));
    const { instances } = h.ctx;
    const dirOf = instances.dirOf;
    let crossed = false;
    // A large space: the export finishes after midnight, on the erasure day.
    instances.dirOf = (slug) => {
      if (!crossed) { crossed = true; later(h, 1); }
      return dirOf.call(instances, slug);
    };
    const before = h.mailer.sent.length;
    await customers.stepAction(c.id, 'deprov-email', 'retry', 'op');
    instances.dirOf = dirOf;
    assert.equal(crossed, true);
    assert.equal(today(h), eraseAt);
    assert.equal(h.mailer.sent.length, before, 'a link that expired yesterday is never mailed');
    const s = h.ctx.models.provisioning.get(c.id, 'deprov-email');
    assert.deepEqual([s.status, s.detail], ['failed', `Effacement prévu le ${frDay(eraseAt)} : aucun lien envoyé.`]);
    assert.equal(customers.view(c.id).deprovisionSteps.find((x) => x.step === 'deprov-email').action, null);
    assert.ok(!customers.view(c.id).history.some((x) => x.text.startsWith('Nouvel export produit')), 'no export is journaled as produced for nothing');
    assert.equal(P.latestExport(c.id).token, earlier.token, 'the dead link is never recorded');
    assert.deepEqual(fs.readdirSync(h.exportsDir), [path.basename(earlier.path)], 'the dead link\'s archive is deleted');
    const step = P.get(c.id, 'deprov-export');
    assert.deepEqual([step.status, step.detail, step.at], [exportStep.status, exportStep.detail, exportStep.at], '« Export complet » keeps its last real export');
  } finally { h.cleanup(); }
});

test('rule 43 — the customer downloads the archive under its plain name, without the unique suffix', async () => {
  const h = makeContext({ versions: ['3.9.0'] });
  const app = createApp(h.ctx, { sessionSecret: 'test', sessionStore: new session.MemoryStore() });
  const server = await listenLocal(app);
  try {
    h.ctx.models.operators.create({ email: 'op@test', name: 'Op', passwordHash: passwordHash.hashPassword('correct horse battery') });
    const { customers, billing } = h.ctx.controllers;
    const c = await customers.create(NEW_CUSTOMER, 'op');
    await billing.deprovision(c.id, { confirmSlug: c.slug }, 'op');
    const token = tokenOf(h.mailer.sent.at(-1));
    assert.match(path.basename(h.ctx.models.provisioning.getExport(token).path), new RegExp(`^${c.slug}-${today(h)}-[0-9a-f]{12}\\.tar\\.gz$`));
    const res = await fetchLocal(`http://127.0.0.1:${server.address().port}/exports/${token}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), new RegExp(`filename="${c.slug}-${today(h)}\\.tar\\.gz"`));
    await res.arrayBuffer();
  } finally {
    await closeServer(server);
    h.cleanup();
  }
});
