// specs/guest-app.md rules 58 and 59 (audit R36 A36-2, R36-P2) — what `register` hands the core: a stored guest host
// equal to GuestFlow's own address is ignored (the web app claims nothing, the setup still asks for an address), and
// « Effacer aussi ses données » names the booklet pages and photos it drops, then deletes the photo files, so they are
// served no more. The plugin registered on a recording context; its database is an in-memory one.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const settingsModel = require('../../../models/settingsModel');
const { freshDb } = require('./guestAppFixtures');

function registered(stored = {}) {
  const db = freshDb();
  const seen = { webApps: [], data: null, setupStatus: null };
  const noop = new Proxy(function noop() {}, { get: () => noop, apply: () => noop });
  const ctx = new Proxy({}, {
    get(_, key) {
      if (key === 'settings') return { declare: () => {}, get: (k) => (k in stored ? stored[k] : null) };
      if (key === 'webApp') return (app) => seen.webApps.push(app);
      if (key === 'data') return (declaration) => { seen.data = declaration; };
      if (key === 'setupStatus') return (fn) => { seen.setupStatus = fn; };
      if (key === 'db') return db;
      return noop;
    },
  });
  require('..').register(ctx);
  return seen;
}

test('rule 58: a stored guest host equal to GuestFlow’s public address is ignored at boot', () => {
  settingsModel.upsert({ publicUrl: 'https://admin.example.test' });
  try {
    const own = registered({ guestHost: 'Admin.example.test' });
    assert.equal(own.webApps.find((w) => w.key === 'guest').host(), null, 'the back office keeps its host');
    assert.match(own.setupStatus(), /adresse de l’application à configurer/);
    const other = registered({ guestHost: 'sejour.example.test' });
    assert.equal(other.webApps.find((w) => w.key === 'guest').host(), 'sejour.example.test');
  } finally {
    settingsModel.upsert({ publicUrl: '' });
  }
});

test('rule 59: the erase names the booklet pages and the photos, and deletes the photo files', () => {
  const uploads = fs.mkdtempSync(path.join(os.tmpdir(), 'guest-uploads-'));
  const previous = process.env.GUESTFLOW_UPLOADS_DIR;
  process.env.GUESTFLOW_UPLOADS_DIR = uploads;
  try {
    const db = freshDb();
    ['bienvenue', 'arrivee', 'depart'].forEach((slug, i) => db.prepare(`INSERT INTO guest_booklet_pages (slug, icon, titleFr, updatedAt)
      VALUES (?, 'home', ?, '2099-01-01T00:00:00Z')`).run(slug, `Page ${i}`));
    ['guest-app/a.webp', 'guest-app/b.webp'].forEach((p) => {
      db.prepare("INSERT INTO guest_media (path, width, height, createdAt) VALUES (?, 1600, 900, '2099-01-01T00:00:00Z')").run(p);
      fs.mkdirSync(path.join(uploads, 'guest-app'), { recursive: true });
      fs.writeFileSync(path.join(uploads, p), 'webp');
    });
    fs.writeFileSync(path.join(uploads, 'logo.png'), 'core');
    const { data } = registered();
    const labels = data.describe(db).map((l) => l.label);
    assert.ok(labels.includes('3 pages de livret'), labels.join(' / '));
    assert.ok(labels.includes('2 photos'), labels.join(' / '));
    data.purge(db);
    assert.equal(fs.existsSync(path.join(uploads, 'guest-app')), false, 'the photos are gone');
    assert.equal(fs.existsSync(path.join(uploads, 'logo.png')), true, 'the core’s uploads stay');
  } finally {
    if (previous === undefined) delete process.env.GUESTFLOW_UPLOADS_DIR;
    else process.env.GUESTFLOW_UPLOADS_DIR = previous;
    fs.rmSync(uploads, { recursive: true, force: true });
  }
});

// Audit R36b N5 — the photos were deleted inside the core's erase transaction, before the tables were dropped: a
// rolled-back erase answered « rien n'a été effacé » with the photos gone. They now go once the erase has committed.
function withUploads(fn) {
  return async () => {
    const uploads = fs.mkdtempSync(path.join(os.tmpdir(), 'guest-uploads-'));
    const previous = process.env.GUESTFLOW_UPLOADS_DIR;
    process.env.GUESTFLOW_UPLOADS_DIR = uploads;
    try {
      fs.mkdirSync(path.join(uploads, 'guest-app'), { recursive: true });
      fs.writeFileSync(path.join(uploads, 'guest-app', 'a.webp'), 'webp');
      await fn(uploads);
    } finally {
      if (previous === undefined) delete process.env.GUESTFLOW_UPLOADS_DIR;
      else process.env.GUESTFLOW_UPLOADS_DIR = previous;
      fs.rmSync(uploads, { recursive: true, force: true });
    }
  };
}

/** The core's erase (`pluginsController.purge`): the plugin's clean-up, then its tables, in one transaction. */
function coreErase(db, data, { fail = false } = {}) {
  db.transaction(() => {
    data.purge(db);
    data.tables.forEach((table) => db.exec(`DROP TABLE IF EXISTS "${table}"`));
    if (fail) throw new Error('settings step failed');
  })();
}

const settled = () => new Promise((resolve) => { setImmediate(resolve); });

test('rule 59 (R36b N5): a rolled-back erase keeps the photos', withUploads(async (uploads) => {
  const { data } = registered();
  const db = freshDb();
  assert.throws(() => coreErase(db, data, { fail: true }), /settings step failed/);
  await settled();
  assert.equal(fs.existsSync(path.join(uploads, 'guest-app', 'a.webp')), true, 'nothing was erased, the photos included');
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'guest_media'").get(), 'the tables are back');
}));

test('rule 59 (R36b N5): a committed erase deletes the photos', withUploads(async (uploads) => {
  const { data } = registered();
  const db = freshDb();
  coreErase(db, data);
  await settled();
  assert.equal(fs.existsSync(path.join(uploads, 'guest-app')), false, 'the photos are gone');
}));
