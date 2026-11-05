// specs/hosting-h1-fleet-runtime.md rules 46-51 (audit R23, console C1-C5) — during an unfinished rename nothing runs on
// the address the instance has not reached yet, and a customer refused at `dir` because another customer's database
// sits at its address has no path into that directory or database.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { makeContext, makeInstance, makeRelease, NEW_CUSTOMER } = require('./helpers');
const { addDays, parisDay } = require('../utils/days');

const TODAY = parisDay(new Date());
const AT = `${TODAY}T10:00:00Z`;
const CUSTOMER = { ...NEW_CUSTOMER, startsAt: TODAY };
const OTHER = { ...CUSTOMER, companyName: 'Autre', contactEmail: 'contact@autre.test' };
const HELD = 'Une base de données existe déjà à cette adresse.';
const PENDING = 'Changement d’adresse à terminer d’abord.';

const checkedOf = (h) => h.ctx.controllers.customers.RENAME_CHECKLIST.map((i) => i.key);
const renameTo = (h, id, slug) => h.ctx.controllers.customers.rename(id, { slug, checked: checkedOf(h) }, 'op');
const running = (h, slug) => Boolean(h.host.procs.get(slug)?.running);
const callsFrom = (h, n) => h.host.calls.slice(n).map((c) => `${c.name}:${c.slug}`);
const hourAgo = (h) => new Date(h.now().getTime() - 3600e3).toISOString();
const ticks = async (n = 5) => { for (let i = 0; i < n; i += 1) await new Promise((r) => setImmediate(r)); };

function gate() {
  let open;
  const closed = new Promise((r) => { open = r; });
  return { closed, open };
}

async function failedRename(options = {}) {
  const h = makeContext({ at: AT, ...options });
  const a = await h.ctx.controllers.customers.create(CUSTOMER, 'op');
  h.host.failNext['process.remove'] = new Error('systemctl busy');
  await renameTo(h, a.id, 'bbb-b');
  return { h, a };
}

// A's rename stayed failed until its alias lapsed; B was then created on A's address and refused at `dir`.
async function heldAddress() {
  const h = makeContext({ at: AT });
  const { customers } = h.ctx.controllers;
  const a = await customers.create(CUSTOMER, 'op');
  const db = new Database(h.ctx.instances.dbPath('aulnes'));
  db.exec(`CREATE TABLE plugin_provisioning (pluginId TEXT, desired TEXT, outcome TEXT, code TEXT, message TEXT, licenceIssuedAt TEXT, eraseOrder TEXT, at TEXT);
    CREATE TABLE plugin_provisioning_meta (key TEXT, value TEXT);
    CREATE TABLE support_access (id INTEGER PRIMARY KEY, requestId TEXT, reason TEXT, requestedAt TEXT, decision TEXT, decidedAt TEXT, expiresAt TEXT, revokedAt TEXT);`);
  db.prepare("INSERT INTO plugin_provisioning_meta VALUES ('capabilities', ?)").run(JSON.stringify({ removalOrders: true }));
  db.prepare("INSERT INTO plugin_provisioning_meta VALUES ('facts:linen', ?)").run(JSON.stringify({ erasable: true, data: [{ label: '12 inventaires de A', count: 12 }] }));
  db.prepare("INSERT OR REPLACE INTO plugins (id, enabled, source) VALUES ('linen', 0, 'builtin')").run();
  db.prepare("INSERT INTO users (email, isActive) VALUES ('owner@a.test', 1)").run();
  db.prepare("INSERT INTO support_access (requestId, reason, requestedAt, decision, expiresAt) VALUES ('r1', 'motif de A', ?, 'accepted', ?)").run(`${TODAY}T08:00:00Z`, `${addDays(TODAY, 3650)}T08:00:00Z`);
  db.close();
  h.host.failNext['process.remove'] = new Error('systemctl busy');
  await renameTo(h, a.id, 'bbb-b');
  const later = addDays(TODAY, 400);
  h.now.set(`${later}T10:00:00Z`);
  const b = await customers.create({ ...OTHER, slug: 'aulnes', startsAt: later }, 'op');
  assert.equal(b.steps.find((s) => s.step === 'dir').detail, HELD);
  const licenceOfA = path.join(h.ctx.instances.dataDir('aulnes'), 'licence.jws');
  return { h, a, b, licenceOfA };
}

test('rule 46 — C1: « Restaurer à une date » is neither offered nor run during an unfinished rename', async () => {
  const { h, a } = await failedRename();
  try {
    const { customers, fleet } = h.ctx.controllers;
    const real = h.host.drivers.backup.restore;
    h.host.drivers.backup.restore = async (inst, o) => { fs.mkdirSync(path.dirname(o.output), { recursive: true }); return real(inst, o); };
    assert.equal(customers.view(a.id).hosting.canRestore, false);

    const before = h.host.calls.length;
    await assert.rejects(fleet.restore(a.id, { at: hourAgo(h) }, 'op'), (e) => e.status === 409 && e.body.error === 'RENAME_PENDING' && e.body.message === PENDING);
    await assert.rejects(fleet.restore(a.id, { at: 'pas une date' }, 'op'), (e) => e.status === 409 && e.body.error === 'RENAME_PENDING');
    assert.deepEqual(callsFrom(h, before), []);
    assert.equal(fs.existsSync(h.ctx.instances.dirOf('bbb-b')), false);
    assert.equal(running(h, 'aulnes'), true);

    // « Réessayer » still finishes the move, and the restore is back.
    const v = await customers.stepAction(a.id, 'rename', 'retry', 'op');
    assert.equal(v.steps.find((s) => s.step === 'rename').status, 'ok');
    assert.equal(running(h, 'bbb-b'), true);
    assert.equal(v.hosting.canRestore, true);
    const done = await fleet.restore(a.id, { at: hourAgo(h) }, 'op');
    assert.match(done.notice, /^Base restaurée/);
  } finally {
    h.cleanup();
  }
});

test('rule 46 — C1: a restore waiting for the lock finds the rename sent meanwhile and stops before any host step', async () => {
  const h = makeContext({ at: AT });
  try {
    const { customers, fleet } = h.ctx.controllers;
    const a = await customers.create(CUSTOMER, 'op');
    const before = h.host.calls.length;
    const lock = gate();
    const holding = h.ctx.provisioner.exclusive(a.id, () => lock.closed);
    const restoring = fleet.restore(a.id, { at: hourAgo(h) }, 'op').then(() => null, (e) => e);
    await ticks();
    const renaming = renameTo(h, a.id, 'bbb-b');
    lock.open();
    await holding;
    const refused = await restoring;
    assert.equal(refused && refused.body.error, 'RENAME_PENDING');
    const v = await renaming;
    assert.equal(v.steps.find((s) => s.step === 'rename').status, 'ok');
    assert.ok(!callsFrom(h, before).includes('process.stop:bbb-b'));
    assert.equal(running(h, 'bbb-b'), true);
  } finally {
    h.cleanup();
  }
});

test('rule 47 — C1: a retry blocked by a folder at the new address keeps the running unit', async () => {
  const { h, a } = await failedRename();
  try {
    const { customers } = h.ctx.controllers;
    const blocker = h.ctx.instances.dirOf('bbb-b');
    fs.mkdirSync(blocker, { recursive: true });
    const before = h.host.calls.length;
    const v = await customers.stepAction(a.id, 'rename', 'retry', 'op');
    const row = v.steps.find((s) => s.step === 'rename');
    assert.equal(row.status, 'failed');
    assert.match(row.detail, /existe déjà/);
    assert.ok(!callsFrom(h, before).includes('process.remove:aulnes'));
    assert.equal(running(h, 'aulnes'), true);
    assert.equal(h.host.drivers.proxy.route('aulnes').kind, 'site');

    // The operator clears the folder: the same « Réessayer » finishes.
    fs.rmSync(blocker, { recursive: true });
    const done = await customers.stepAction(a.id, 'rename', 'retry', 'op');
    assert.equal(done.steps.find((s) => s.step === 'rename').status, 'ok');
    assert.equal(running(h, 'bbb-b'), true);
  } finally {
    h.cleanup();
  }
});

test('rule 48 — C2: a customer held off an address writes no licence into that directory', async () => {
  const { h, b, licenceOfA } = await heldAddress();
  try {
    const { customers } = h.ctx.controllers;
    const before = fs.readFileSync(licenceOfA, 'utf8');
    customers.reissueAll('système', () => {});
    customers.refresh(b.id, 'op');
    const result = customers.issueLicence(b.id);
    assert.equal(result.written, false);
    assert.equal(result.reason, HELD);
    assert.equal(customers.view(b.id).actions.downloadLicence, false);
    assert.equal(fs.readFileSync(licenceOfA, 'utf8'), before);
    const row = h.ctx.models.provisioning.get(b.id, 'licence');
    assert.equal(row.status, 'failed');
    assert.equal(row.detail, HELD);
    assert.equal(h.ctx.models.meta.get(`licenceIssuedAt:${b.id}`) || null, null);
  } finally {
    h.cleanup();
  }
});

test('rule 48 — C2: its modules page reads nothing there and can order nothing there', async () => {
  const { h, b, licenceOfA } = await heldAddress();
  try {
    const { modules, customers } = h.ctx.controllers;
    const before = fs.readFileSync(licenceOfA, 'utf8');
    const line = () => modules.view(b.id).included.find((l) => l.id === 'linen');
    const first = line();
    assert.deepEqual(first.eraseLines, []);
    assert.equal(first.canErase, false);
    modules.toggle(b.id, 'linen', false, 'op', { withDependents: (first.alsoOff || []).map((r) => r.id) });
    const off = line();
    assert.equal(off.canErase, false);
    assert.deepEqual(off.eraseLines, []);
    assert.throws(() => modules.erase(b.id, 'linen', 'aulnes', 'op', 'erase'), (e) => e.status === 409 && e.body.error === 'NOTHING_TO_ERASE');
    assert.deepEqual(h.ctx.models.customerPlugins.pendingOrders(b.id), []);
    assert.equal(fs.readFileSync(licenceOfA, 'utf8'), before);
    assert.equal(customers.fleet().rows.find((r) => r.id === b.id).installedCount, null);
  } finally {
    h.cleanup();
  }
});

test('rule 48 — C2: seeding and the minute sweep read nothing there', async () => {
  const { h, b } = await heldAddress();
  try {
    const { modules } = h.ctx.controllers;
    const c = h.ctx.models.customers.get(b.id);
    assert.equal(modules.seedCustomer({ ...c, pluginsSeededAt: null }), false);
    h.ctx.db.prepare('UPDATE customers SET pluginsSeededAt = NULL WHERE id = ?').run(b.id);
    assert.equal(modules.view(b.id).seedLabel, 'Espace illisible : modules non relevés.');
    const tables = new Database(h.ctx.instances.dbPath('aulnes'));
    tables.exec('ALTER TABLE plugin_provisioning RENAME TO p_aside; ALTER TABLE plugin_provisioning_meta RENAME TO m_aside;');
    assert.equal(modules.view(b.id).seedLabel, 'Espace illisible : modules non relevés.', 'never the too-old label read from A');
    tables.exec('ALTER TABLE p_aside RENAME TO plugin_provisioning; ALTER TABLE m_aside RENAME TO plugin_provisioning_meta;');
    tables.close();
    const orderId = 'order-of-b';
    h.ctx.models.customerPlugins.addOrder({ orderId, customerId: b.id, pluginId: 'linen', createdAt: h.now().toISOString(), operator: 'op', removal: false });
    const db = new Database(h.ctx.instances.dbPath('aulnes'));
    db.prepare('INSERT INTO plugin_provisioning_meta VALUES (?, ?)').run(`erase:${orderId}`, h.now().toISOString());
    db.close();
    assert.deepEqual(modules.sweep(), { seeded: 0, acknowledged: 0 });
    assert.deepEqual(h.ctx.models.customerPlugins.pendingOrders(b.id).map((o) => o.orderId), [orderId]);
  } finally {
    h.cleanup();
  }
});

test('rule 48 — C2: support neither reads, asks nor opens there', async () => {
  const { h, b } = await heldAddress();
  try {
    const { support } = h.ctx.controllers;
    assert.deepEqual(support.state(b.id), { available: false, unavailableReason: HELD });
    const journal = () => h.ctx.controllers.customers.view(b.id).history.filter((l) => /support/i.test(l.text)).length;
    const entries = journal();
    assert.throws(() => support.link(b.id, 'op'), (e) => e.status === 409 && e.body.error === 'NOT_OPEN');
    assert.throws(() => support.request(b.id, { reason: 'motif' }, 'op'), (e) => e.status === 409 && e.body.error === 'UNAVAILABLE' && e.body.message === HELD);
    assert.equal(fs.existsSync(path.join(h.ctx.instances.dataDir('aulnes'), 'support-request.jws')), false);
    assert.equal(journal(), entries);
  } finally {
    h.cleanup();
  }
});

test('rule 48 — C2: the directory files no account of that database under this customer', async () => {
  const { h, b } = await heldAddress();
  try {
    const { login } = h.ctx.controllers;
    login.readDirectory();
    assert.equal(h.ctx.models.directory.count(b.id), 0);
    assert.equal(login.lookup('owner@a.test').kind, 'none');
  } finally {
    h.cleanup();
  }
});

test('rule 48 — C2: the customer whose rename is unfinished still reads its own space, and the way out still works', async () => {
  const { h, a } = await failedRename();
  try {
    const { customers } = h.ctx.controllers;
    assert.equal(customers.spaceSlug(h.ctx.models.customers.get(a.id)), 'aulnes');
  } finally {
    h.cleanup();
  }
  const held = await heldAddress();
  try {
    const { customers, support } = held.h.ctx.controllers;
    assert.equal(customers.spaceSlug(held.h.ctx.models.customers.get(held.b.id)), null);
    const before = fs.readFileSync(held.licenceOfA, 'utf8');
    await renameTo(held.h, held.b.id, 'ccc-c');
    const moved = held.h.ctx.models.customers.get(held.b.id);
    assert.equal(moved.slug, 'ccc-c');
    assert.equal(customers.spaceSlug(moved), 'ccc-c');
    assert.equal(fs.readFileSync(held.licenceOfA, 'utf8'), before);
    assert.notEqual(support.state(held.b.id).unavailableReason, HELD);
    const resumed = await customers.stepAction(held.b.id, 'dir', 'resume', 'op');
    assert.equal(resumed.steps.find((s) => s.step === 'licence').status, 'ok');
  } finally {
    held.h.cleanup();
  }
});

test('rule 49 — C3: an address with a directory is refused at the preview and at the rename, before anything moves', async () => {
  const { h } = await failedRename();
  try {
    const { customers } = h.ctx.controllers;
    const later = addDays(TODAY, 400);
    h.now.set(`${later}T10:00:00Z`);
    const c = await customers.create({ ...OTHER, slug: 'kkk-k', startsAt: later }, 'op');
    const refusal = 'Adresse déjà utilisée par un autre client, y compris archivé.';
    assert.equal(customers.renamePreview(c.id, { slug: 'aulnes' }).error, refusal);
    const before = h.host.calls.length;
    await assert.rejects(renameTo(h, c.id, 'aulnes'), (e) => e.status === 400 && e.body.message === refusal);
    assert.deepEqual(callsFrom(h, before), []);
    assert.equal(h.ctx.models.customers.get(c.id).slug, 'kkk-k');
    assert.equal(h.ctx.models.provisioning.get(c.id, 'rename') ?? null, null);
    assert.equal(running(h, 'kkk-k'), true);
    assert.equal(customers.view(c.id).actions.rename, true);
    assert.equal(customers.renamePreview(c.id, { slug: 'free-address' }).error, null);
  } finally {
    h.cleanup();
  }
});

test('rule 50 — C4: a fleet update steps over an unfinished rename and carries on', async () => {
  const { h, a } = await failedRename();
  try {
    const { customers, fleet } = h.ctx.controllers;
    const z = await customers.create({ ...CUSTOMER, slug: 'zzz-z', companyName: 'Z', contactEmail: 'z@z.test' }, 'op');
    makeRelease(h.ctx.releases.dir, '9.9.9');
    const before = h.host.calls.length;
    fleet.startUpdate({ targetVersion: '9.9.9' }, 'op');
    await h.ctx.fleetUpdater.whenIdle();
    const [u] = fleet.view().history;
    assert.equal(u.state, 'done');
    const item = (id) => u.items.find((i) => i.customerId === id);
    assert.equal(item(a.id).state, 'skipped');
    assert.equal(item(a.id).detail, PENDING);
    assert.equal(item(z.id).state, 'done');
    assert.ok(!callsFrom(h, before).some((c) => c.endsWith(':bbb-b') || c.endsWith(':aulnes')));
    assert.equal(running(h, 'aulnes'), true);
    assert.equal(h.ctx.models.hosting.rolledBackTargets().has('9.9.9'), false);
    assert.notEqual(h.ctx.models.hosting.get(a.id).version, '9.9.9');
  } finally {
    h.cleanup();
  }
});

test('rule 50 — C4: a rename sent while the fleet item waits for the lock is stepped over too', async () => {
  const h = makeContext({ at: AT });
  try {
    const { customers, fleet } = h.ctx.controllers;
    const a = await customers.create(CUSTOMER, 'op');
    makeRelease(h.ctx.releases.dir, '9.9.9');
    const lock = gate();
    const holding = h.ctx.provisioner.exclusive(a.id, () => lock.closed);
    fleet.startUpdate({ targetVersion: '9.9.9' }, 'op');
    const renaming = renameTo(h, a.id, 'bbb-b');
    lock.open();
    await holding;
    await h.ctx.fleetUpdater.whenIdle();
    const v = await renaming;
    assert.equal(fleet.view().history[0].items[0].state, 'skipped');
    assert.equal(v.steps.find((s) => s.step === 'rename').status, 'ok');
    assert.equal(running(h, 'bbb-b'), true);
  } finally {
    h.cleanup();
  }
});

test('rule 50 — C4: the plugin push and the catalogue read an unfinished rename at the address that answers', async () => {
  const pushed = [];
  let h;
  const installer = {
    async install(inst, id, version) { pushed.push([inst.slug, id, version]); h.host.loaded.set(inst.slug, { [id]: version }); },
    async rollback() {},
    published: () => ['1.2.0'],
  };
  h = makeContext({ at: AT, pluginInstaller: installer });
  try {
    const { customers, fleet, catalogue } = h.ctx.controllers;
    makeInstance(h.root, 'aulnes', { installed: ['linen', 'tariff-recipes'], versions: { linen: '1.0.0', 'tariff-recipes': '1.0.0' } });
    makeInstance(h.root, 'moulin', { installed: ['linen'], versions: { linen: '1.0.0' } });
    const a = await customers.create({ ...CUSTOMER, planCode: 'premium' }, 'op');
    await customers.create({ ...CUSTOMER, slug: 'moulin', companyName: 'Le Moulin', contactEmail: 'jo@moulin.fr' }, 'op');
    h.host.failNext['process.remove'] = new Error('systemctl busy');
    await renameTo(h, a.id, 'bbb-b');

    assert.equal(fleet.view().pluginPush.plugins.find((p) => p.id === 'linen').count, 2);
    fleet.pushPlugin({ pluginId: 'linen', version: '1.2.0' }, 'op');
    await h.ctx.fleetUpdater.whenIdle();
    const [u] = fleet.view().history;
    assert.deepEqual(u.items.map((i) => i.state).sort(), ['done', 'skipped']);
    assert.equal(u.items.find((i) => i.customerId === a.id).state, 'skipped');
    assert.deepEqual(pushed, [['moulin', 'linen', '1.2.0']]);

    const lowest = { ...catalogue.view().lowest, 'tariff-recipes': null };
    const { lines } = catalogue.impact({ lowest });
    assert.ok(lines.some((l) => /1 client Premium garde Recettes tarifaires déjà installé/.test(l)), lines.join('\n'));
  } finally {
    h.cleanup();
  }
});

test('rule 48 with rule 50 — a held customer reads nothing there for the catalogue, and is not grandfathered from it', async () => {
  const { h, b } = await heldAddress();
  try {
    const { customers, catalogue } = h.ctx.controllers;
    assert.equal(customers.spaceFacts(h.ctx.models.customers.get(b.id)), null);
    const view = catalogue.view();
    const { lines } = catalogue.impact({ lowest: { ...view.lowest, linen: null } });
    assert.ok(lines.length > 0);
    assert.ok(!lines.some((l) => /[1-9] clients? \S+ garde(nt)? Linge/.test(l)), lines.join('\n'));
    assert.ok(lines.some((l) => /garde Linge.*illisible/.test(l)), lines.join('\n'));
  } finally {
    h.cleanup();
  }
});

test('rule 51 — C5: no sign-in link on an archived customer', async () => {
  const h = makeContext({ at: AT });
  try {
    const { customers, support } = h.ctx.controllers;
    const a = await customers.create(CUSTOMER, 'op');
    const db = new Database(h.ctx.instances.dbPath('aulnes'));
    db.exec('CREATE TABLE support_access (id INTEGER PRIMARY KEY, requestId TEXT, reason TEXT, requestedAt TEXT, decision TEXT, decidedAt TEXT, expiresAt TEXT, revokedAt TEXT)');
    db.prepare("INSERT INTO support_access (requestId, reason, requestedAt, decision, expiresAt) VALUES ('r1', 'm', ?, 'accepted', ?)").run(`${TODAY}T08:00:00Z`, `${addDays(TODAY, 3650)}T08:00:00Z`);
    db.close();
    assert.ok(support.link(a.id, 'op').url);
    await customers.deprovision(a.id, { confirmSlug: 'aulnes' }, 'op');
    assert.equal(support.state(a.id).unavailableReason, 'Client archivé.');
    const opened = () => customers.view(a.id).history.filter((l) => l.text === 'Espace du client ouvert par le support.').length;
    const entries = opened();
    assert.throws(() => support.link(a.id, 'op'), (e) => e.status === 409 && e.body.error === 'UNAVAILABLE' && e.body.message === 'Client archivé.');
    assert.equal(opened(), entries);
  } finally {
    h.cleanup();
  }
});
