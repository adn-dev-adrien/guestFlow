// specs/control-plane-plans-and-access.md rules 21 and 22 — renaming an address: every item ticked,
// the slug's rules, the old slug reserved for 12 months then free, the licence re-issued under the
// new slug. Since the hosting (specs/hosting-h1-fleet-runtime.md rules 5, 7) the directory moves by
// itself and the old address redirects for 90 days.

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeContext, makeInstance, licencePayload, NEW_CUSTOMER } = require('./helpers');

async function setup() {
  const h = makeContext({ at: '2026-10-01T08:00:00Z' });
  makeInstance(h.root, 'aulnes');
  const c = await h.ctx.controllers.customers.create(NEW_CUSTOMER, 'op');
  await h.ctx.controllers.customers.create({ ...NEW_CUSTOMER, slug: 'moulin', companyName: 'Le Moulin', contactEmail: 'jo@moulin.fr' }, 'op');
  const all = h.ctx.controllers.customers.RENAME_CHECKLIST.map((i) => i.key);
  return { ...h, c, all, customers: h.ctx.controllers.customers };
}

test('rule 22 — the preview names the new address, the date, and what must be redone', async () => {
  const s = await setup();
  try {
    const p = s.customers.renamePreview(s.c.id, { slug: 'aulnes-neuf' });
    assert.equal(p.error, null);
    assert.equal(p.url, 'https://aulnes-neuf.guestflow.test');
    assert.equal(p.until, 'L’ancienne adresse aulnes.guestflow.test redirige (301) jusqu’au 30/12/2026 et reste réservée jusqu’au 01/10/2027.');
    // The public URL follows the rename by itself (specs/hosting-h1-fleet-runtime.md rule 25).
    assert.deepEqual(p.checklist.map((i) => i.key), ['wordpress', 'ical', 'oauth', 'push']);
    assert.equal(s.customers.renamePreview(s.c.id, { slug: 'admin' }).error, 'Adresse réservée.');
    assert.equal(s.customers.renamePreview(s.c.id, { slug: 'moulin' }).error, 'Adresse déjà utilisée par un autre client, y compris archivé.');
    assert.equal(s.customers.renamePreview(s.c.id, { slug: 'aulnes' }).error, 'C’est déjà son adresse.');
  } finally {
    s.cleanup();
  }
});

test('rule 22 — refused until every item is ticked; then renamed, journaled, moved, licence re-issued', async () => {
  const s = await setup();
  try {
    await assert.rejects(s.customers.rename(s.c.id, { slug: 'aulnes-neuf', checked: s.all.slice(1) }, 'op'), (err) => err.body.error === 'CHECKLIST' && /Réglage du plugin WordPress/.test(err.body.message));
    const v = await s.customers.rename(s.c.id, { slug: 'aulnes-neuf', checked: s.all }, 'op');
    assert.equal(v.slug, 'aulnes-neuf');
    assert.equal(v.url, 'https://aulnes-neuf.guestflow.test');
    assert.deepEqual(v.formerAddresses, ['aulnes.guestflow.test → redirigée jusqu’au 30/12/2026, réservée jusqu’au 01/10/2027']);
    assert.ok(v.history.some((x) => x.text === 'Adresse : aulnes → aulnes-neuf ; l’ancienne redirige jusqu’au 30/12/2026 et reste réservée jusqu’au 01/10/2027'));
    const step = v.steps.find((x) => x.step === 'rename');
    assert.equal(step.status, 'ok');
    assert.match(step.detail, /^aulnes\/ → aulnes-neuf\/ ; aulnes redirige jusqu’au 30\/12\/2026\.$/);
    assert.equal(licencePayload(s.customers.licenceDownload(s.c.id).token).slug, 'aulnes-neuf');
    assert.equal(v.steps.find((x) => x.step === 'licence').status, 'ok', 'written in the moved directory');
  } finally {
    s.cleanup();
  }
});

test('rules 21, 22 — the old slug stays taken for 12 months, then is free again', async () => {
  const s = await setup();
  try {
    await s.customers.rename(s.c.id, { slug: 'aulnes-neuf', checked: s.all }, 'op');
    const other = { ...NEW_CUSTOMER, slug: 'aulnes', companyName: 'Autre', contactEmail: 'x@autre.fr' };
    assert.equal(s.customers.preview(other).errors.slug, 'Adresse déjà utilisée par un autre client, y compris archivé.');
    s.now.set('2027-10-02T08:00:00Z');
    assert.equal(s.customers.preview(other).errors.slug, undefined);
  } finally {
    s.cleanup();
  }
});

test('rule 22 — until the directory is moved, the login page and the directory use the old address', async () => {
  const s = await setup();
  try {
    const Database = require('better-sqlite3');
    const db = new Database(s.ctx.instances.dbPath('aulnes'));
    db.prepare("INSERT INTO users (email) VALUES ('claire@aulnes.fr')").run();
    db.close();
    s.ctx.controllers.login.readDirectory();
    s.host.failNext['process.enableNow'] = new Error('Unit guestflow@aulnes-neuf.service failed');
    await s.customers.rename(s.c.id, { slug: 'aulnes-neuf', checked: s.all }, 'op');
    s.ctx.controllers.login.readDirectory();
    const during = s.ctx.controllers.login.lookup('claire@aulnes.fr');
    assert.deepEqual(during.spaces.map((x) => x.address), ['aulnes.guestflow.test'], 'the old address still answers');
    await s.customers.stepAction(s.c.id, 'rename', 'retry', 'op');
    s.ctx.controllers.login.readDirectory();
    assert.deepEqual(s.ctx.controllers.login.lookup('claire@aulnes.fr').spaces.map((x) => x.address), ['aulnes-neuf.guestflow.test']);
  } finally {
    s.cleanup();
  }
});
