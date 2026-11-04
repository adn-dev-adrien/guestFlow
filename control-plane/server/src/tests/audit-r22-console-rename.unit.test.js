// specs/hosting-h1-fleet-runtime.md rule 45 (audit R22, console N1 and N2) — an instance the console has lost track
// of keeps serving a closed customer and hands its guests' data to the next customer of that address. A rename waits
// for the one before it, is never recorded as done on a directory it did not find, and a retry starts from the slug
// the instance really left; the creation never settles on a database already at its address.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { makeContext, NEW_CUSTOMER } = require('./helpers');
const { addDays } = require('../utils/days');

const TODAY = new Date().toISOString().slice(0, 10);
const AT = `${TODAY}T10:00:00Z`;
const CUSTOMER = { ...NEW_CUSTOMER, startsAt: TODAY };
const MARKER = 'first customer guest data';
const OTHER = { ...CUSTOMER, companyName: 'Autre', contactEmail: 'contact@autre.test' };

async function setup() {
  const h = makeContext({ at: AT });
  const { customers } = h.ctx.controllers;
  const c = await customers.create(CUSTOMER, 'op');
  const db = new Database(h.ctx.instances.dbPath('aulnes'));
  db.exec('CREATE TABLE marker (v TEXT)');
  db.prepare('INSERT INTO marker VALUES (?)').run(MARKER);
  db.close();
  const checked = customers.RENAME_CHECKLIST.map((i) => i.key);
  const rename = (slug) => customers.rename(c.id, { slug, checked }, 'op');
  const dirOf = (slug) => fs.existsSync(h.ctx.instances.dirOf(slug));
  const renameRow = () => h.ctx.models.provisioning.get(c.id, 'rename');
  const running = (slug) => Boolean(h.host.procs.get(slug)?.running);
  return { ...h, customers, c, rename, dirOf, renameRow, running };
}

function markerOf(h, slug) {
  const db = new Database(h.ctx.instances.dbPath(slug), { readonly: true });
  try {
    return db.prepare("SELECT name FROM sqlite_master WHERE name = 'marker'").get() ? db.prepare('SELECT v FROM marker').all() : [];
  } finally {
    db.close();
  }
}

test('rule 45 — N1: after a failed rename, a second one is refused and the customer can neither be closed nor lost', async () => {
  const s = await setup();
  try {
    // Step 1: the first rename fails on the host; the page stops offering another one.
    s.host.failNext['process.remove'] = new Error('systemctl busy');
    await s.rename('bbb-b');
    assert.equal(s.renameRow().status, 'failed');
    assert.equal(s.dirOf('aulnes'), true);
    let v = s.customers.view(s.c.id);
    assert.equal(v.actions.rename, false);
    assert.equal(v.actions.renameHint, 'Changement d’adresse à terminer d’abord.');

    // Step 2: the second rename is refused before anything is written.
    const entries = v.history.length;
    await assert.rejects(s.rename('ccc-c'), (e) => e.status === 409 && e.body.error === 'RENAME_PENDING' && e.body.message === 'Changement d’adresse à terminer d’abord.');
    assert.equal(s.ctx.models.customers.get(s.c.id).slug, 'bbb-b');
    assert.deepEqual(s.ctx.models.directory.aliasesOf(s.c.id, TODAY).map((a) => a.slug), ['aulnes']);
    assert.equal(s.renameRow().status, 'failed');
    assert.equal(s.ctx.controllers.customers.servedSlug(s.ctx.models.customers.get(s.c.id)), 'aulnes');
    assert.equal(s.running('aulnes'), true);
    assert.equal(s.host.drivers.proxy.route('aulnes').kind, 'site');
    assert.equal(s.customers.view(s.c.id).history.length, entries);

    // Step 3: closing waits too, so the export cannot be skipped.
    await assert.rejects(s.customers.deprovision(s.c.id, { confirmSlug: 'bbb-b' }, 'op'), (e) => e.body.error === 'RENAME_PENDING');
    assert.equal(s.ctx.models.customers.get(s.c.id).archivedAt, null);

    // Step 4: nothing to erase while it is open; its data and its address stay held.
    await assert.rejects(s.customers.eraseNow(s.c.id, { confirmSlug: 'bbb-b' }, 'op'), (e) => e.body.error === 'NOT_ARCHIVED');
    assert.deepEqual(markerOf(s, 'aulnes'), [{ v: MARKER }]);

    // Step 5: the next customer cannot take the address.
    assert.equal(s.customers.preview({ ...OTHER, slug: 'aulnes' }).errors.slug, 'Adresse déjà utilisée par un autre client, y compris archivé.');

    // « Réessayer » finishes the move, and a rename is offered again.
    v = await s.customers.stepAction(s.c.id, 'rename', 'retry', 'op');
    assert.equal(s.renameRow().status, 'ok');
    assert.equal(v.actions.rename, true);
    assert.equal(v.actions.renameHint, null);
    assert.deepEqual(markerOf(s, 'bbb-b'), [{ v: MARKER }]);
    assert.equal(s.running('bbb-b'), true);

    // The real closing: export taken, unit stopped; the erasure takes the database; the address is then a clean one.
    v = await s.customers.deprovision(s.c.id, { confirmSlug: 'bbb-b' }, 'op');
    assert.deepEqual(v.deprovisionSteps.map((x) => [x.step, x.status]), [['deprov-export', 'ok'], ['deprov-email', 'ok'], ['deprov-stop', 'ok']]);
    assert.equal(s.running('bbb-b'), false);
    await s.customers.eraseNow(s.c.id, { confirmSlug: 'bbb-b' }, 'op');
    assert.equal(s.dirOf('bbb-b'), false);
    const next = await s.customers.create({ ...OTHER, slug: 'aulnes' }, 'op');
    assert.ok(next.steps.filter((x) => x.step !== 'rename').every((x) => x.status === 'ok'));
    assert.deepEqual(markerOf(s, 'aulnes'), []);
  } finally {
    s.cleanup();
  }
});

test('rule 45 — a rename still in flight refuses the next one, with or without its row', async () => {
  const s = await setup();
  try {
    const first = s.rename('bbb-b');
    await assert.rejects(s.rename('ccc-c'), (e) => e.status === 409 && e.body.error === 'RENAME_PENDING');
    await first;
    assert.equal(s.renameRow().status, 'ok');
    const after = await s.rename('ccc-c');
    assert.equal(after.slug, 'ccc-c');
    assert.equal(s.dirOf('ccc-c'), true);
  } finally {
    s.cleanup();
  }
});

test('rule 45 — N2: two renames on one day, the second failing: the page and the retry use the slug the instance is in', async () => {
  const s = await setup();
  try {
    await s.rename('bbb-b');
    s.host.failNext['process.remove'] = new Error('systemctl busy');
    await s.rename('ccc-c');
    assert.deepEqual(s.ctx.models.directory.aliasesOf(s.c.id, TODAY).map((a) => a.slug), ['bbb-b', 'aulnes'], 'same date: last left first');
    assert.equal(s.customers.servedSlug(s.ctx.models.customers.get(s.c.id)), 'bbb-b');
    assert.equal(s.dirOf('bbb-b'), true);

    const v = await s.customers.stepAction(s.c.id, 'rename', 'retry', 'op');
    const step = v.steps.find((x) => x.step === 'rename');
    assert.equal(step.status, 'ok');
    assert.match(step.detail, /^bbb-b\/ → ccc-c\/ ; /);
    assert.deepEqual([s.dirOf('aulnes'), s.dirOf('bbb-b'), s.dirOf('ccc-c')], [false, false, true]);
    assert.equal(s.host.procs.has('bbb-b'), false);
    assert.equal(s.running('ccc-c'), true);
    assert.equal(s.host.drivers.proxy.route('ccc-c').kind, 'site');
    assert.equal(s.host.drivers.proxy.route('bbb-b').kind, 'redirect');
    assert.deepEqual(markerOf(s, 'ccc-c'), [{ v: MARKER }]);
  } finally {
    s.cleanup();
  }
});

test('rule 45 — a rename that finds no directory for a live instance fails, sets no redirect, and leaves the rename pending', async () => {
  const s = await setup();
  try {
    s.ctx.models.customers.setSlug(s.c.id, 'ccc-c');
    s.ctx.models.directory.addAlias('aulnes', s.c.id, addDays(TODAY, 30));
    await s.ctx.provisioner.rename(s.c.id, 'bbb-b');
    const row = s.renameRow();
    assert.deepEqual([row.status, row.detail], ['failed', 'Dossier de l’instance introuvable.']);
    assert.equal(s.host.drivers.proxy.route('bbb-b'), null);
    assert.equal(s.ctx.models.hosting.redirectsOf(s.c.id).length, 0);
    assert.equal(s.running('aulnes'), true);
    assert.equal(s.customers.view(s.c.id).actions.rename, false);
  } finally {
    s.cleanup();
  }
});

test('rule 45 — a database already at the address stops the creation at its first step, untouched; removing it lets « Reprendre » finish', async () => {
  const h = makeContext({ at: AT });
  try {
    const { customers } = h.ctx.controllers;
    const file = h.ctx.instances.dbPath('aulnes');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = new Database(file);
    db.exec('CREATE TABLE marker (v TEXT)');
    db.prepare('INSERT INTO marker VALUES (?)').run(MARKER);
    db.close();

    const c = await customers.create(CUSTOMER, 'op');
    const dirStep = c.steps.find((x) => x.step === 'dir');
    assert.deepEqual([dirStep.status, dirStep.detail], ['failed', 'Une base de données existe déjà à cette adresse.']);
    assert.deepEqual(c.steps.filter((x) => x.step !== 'dir').map((x) => x.status).filter((x) => x === 'ok'), []);
    assert.deepEqual(h.host.calls.map((x) => x.name), []);
    assert.deepEqual(markerOf(h, 'aulnes'), [{ v: MARKER }]);
    assert.equal(h.firstAdminCalls.length, 0);

    const again = await customers.stepAction(c.id, 'dir', 'resume', 'op');
    assert.equal(again.steps.find((x) => x.step === 'dir').status, 'failed');
    assert.deepEqual(markerOf(h, 'aulnes'), [{ v: MARKER }]);

    fs.rmSync(file);
    const done = await customers.stepAction(c.id, 'dir', 'resume', 'op');
    assert.ok(done.steps.filter((x) => x.step !== 'rename').every((x) => x.status === 'ok'), JSON.stringify(done.steps));
    assert.deepEqual(markerOf(h, 'aulnes'), []);
  } finally {
    h.cleanup();
  }
});

test('rule 45 — resuming past the first step finds its own database and goes on; a customer with no port yet still renames', async () => {
  const h = makeContext({ at: AT });
  try {
    const { customers } = h.ctx.controllers;
    h.host.failNext['proxy.writeSite'] = new Error('caddy');
    const c = await customers.create(CUSTOMER, 'op');
    assert.equal(c.steps.find((x) => x.step === 'route').status, 'failed');
    const done = await customers.stepAction(c.id, 'route', 'resume', 'op');
    assert.ok(done.steps.every((x) => x.status === 'ok'), JSON.stringify(done.steps));

    // Stopped at its first step: no port, nothing on the host, so there is no instance to move.
    fs.mkdirSync(path.dirname(h.ctx.instances.dbPath('moulin')), { recursive: true });
    new Database(h.ctx.instances.dbPath('moulin')).close();
    const other = await customers.create({ ...OTHER, slug: 'moulin' }, 'op');
    assert.equal(other.steps.find((x) => x.step === 'dir').status, 'failed');
    fs.rmSync(h.ctx.instances.dirOf('moulin'), { recursive: true });
    const moved = await customers.rename(other.id, { slug: 'moulin-neuf', checked: customers.RENAME_CHECKLIST.map((i) => i.key) }, 'op');
    const row = moved.steps.find((x) => x.step === 'rename');
    assert.deepEqual([row.status, row.detail], ['ok', 'Aucune instance à déplacer ; redirection posée.']);
    assert.equal(h.host.drivers.proxy.route('moulin').kind, 'redirect');
  } finally {
    h.cleanup();
  }
});

test('rule 45 — an address freed while a rename stayed failed never hands its database over, and the stale retry fails', async () => {
  const s = await setup();
  try {
    s.host.failNext['process.remove'] = new Error('systemctl busy');
    await s.rename('bbb-b');
    s.now.set(`${addDays(TODAY, 400)}T10:00:00Z`);
    assert.equal(s.customers.preview({ ...OTHER, slug: 'aulnes', startsAt: addDays(TODAY, 400) }).errors.slug, undefined, 'the alias has expired');

    const other = await s.customers.create({ ...OTHER, slug: 'aulnes', startsAt: addDays(TODAY, 400) }, 'op');
    const step = other.steps.find((x) => x.step === 'dir');
    assert.deepEqual([step.status, step.detail], ['failed', 'Une base de données existe déjà à cette adresse.']);
    assert.equal(s.firstAdminCalls.length, 1, 'only the first customer got an account');

    const v = await s.customers.stepAction(s.c.id, 'rename', 'retry', 'op');
    const row = v.steps.find((x) => x.step === 'rename');
    assert.deepEqual([row.status, row.detail], ['failed', 'Dossier de l’instance introuvable.']);
    assert.deepEqual(markerOf(s, 'aulnes'), [{ v: MARKER }]);
  } finally {
    s.cleanup();
  }
});
