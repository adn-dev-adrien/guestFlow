// specs/control-plane-plans-and-access.md rules 21 and 22 — renaming an address: every item ticked,
// the slug's rules, the old slug reserved and redirected for 12 months then free, the licence
// re-issued under the new slug, and the manual step until phase H.

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
    assert.equal(p.until, 'L’ancienne adresse aulnes.guestflow.test reste réservée et redirige (301) jusqu’au 01/10/2027.');
    assert.equal(p.checklist.length, 5);
    assert.equal(s.customers.renamePreview(s.c.id, { slug: 'admin' }).error, 'Adresse réservée.');
    assert.equal(s.customers.renamePreview(s.c.id, { slug: 'moulin' }).error, 'Adresse déjà utilisée par un autre client, y compris archivé.');
    assert.equal(s.customers.renamePreview(s.c.id, { slug: 'aulnes' }).error, 'C’est déjà son adresse.');
  } finally {
    s.cleanup();
  }
});

test('rule 22 — refused until every item is ticked; then renamed, journaled, licence re-issued, step to do', async () => {
  const s = await setup();
  try {
    assert.throws(() => s.customers.rename(s.c.id, { slug: 'aulnes-neuf', checked: s.all.slice(1) }, 'op'), (err) => err.body.error === 'CHECKLIST' && /Réglage du plugin WordPress/.test(err.body.message));
    const v = s.customers.rename(s.c.id, { slug: 'aulnes-neuf', checked: s.all }, 'op');
    assert.equal(v.slug, 'aulnes-neuf');
    assert.equal(v.url, 'https://aulnes-neuf.guestflow.test');
    assert.deepEqual(v.formerAddresses, ['aulnes.guestflow.test → redirigée jusqu’au 01/10/2027']);
    assert.ok(v.history.some((x) => x.text === 'Adresse : aulnes → aulnes-neuf ; l’ancienne redirige jusqu’au 01/10/2027'));
    const step = v.steps.find((x) => x.step === 'rename');
    assert.equal(step.status, 'todo');
    assert.match(step.detail, /^Déplacer aulnes\/ vers aulnes-neuf\//);
    assert.equal(licencePayload(s.customers.licenceDownload(s.c.id).token).slug, 'aulnes-neuf');
    assert.equal(v.steps.find((x) => x.step === 'licence').status, 'failed', 'written once the directory has moved');
  } finally {
    s.cleanup();
  }
});

test('rules 21, 22 — the old slug stays taken for 12 months, then is free again', async () => {
  const s = await setup();
  try {
    s.customers.rename(s.c.id, { slug: 'aulnes-neuf', checked: s.all }, 'op');
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
    s.customers.rename(s.c.id, { slug: 'aulnes-neuf', checked: s.all }, 'op');
    s.ctx.controllers.login.readDirectory();
    const during = s.ctx.controllers.login.lookup('claire@aulnes.fr');
    assert.deepEqual(during.spaces.map((x) => x.address), ['aulnes.guestflow.test'], 'the old address still answers');
    await s.customers.stepAction(s.c.id, 'rename', 'done', 'op');
    assert.deepEqual(s.ctx.controllers.login.lookup('claire@aulnes.fr').spaces.map((x) => x.address), ['aulnes-neuf.guestflow.test']);
  } finally {
    s.cleanup();
  }
});
