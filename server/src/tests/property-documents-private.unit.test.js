// Audit 2026-10-28 (authz L2, injection #5) — property documents are private: stored outside the public
// /uploads tree, served only through the authenticated download route, deleted with their row, and the
// files uploaded before the audit are moved at boot. specs/settings-rationalization.md rule 32.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const http = require('http');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');

const SERVER_DIR = path.resolve(__dirname, '..', '..');

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

function boot(dir, port) {
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: SERVER_DIR,
    env: {
      ...process.env, PORT: String(port), DB_PATH: path.join(dir, 'g.db'), GUESTFLOW_UPLOADS_DIR: path.join(dir, 'uploads'),
      GUESTFLOW_LOCAL_ENV: path.join(dir, '.env.local'), NODE_ENV: 'development', GUESTFLOW_DEV: '1', GUESTFLOW_SMTP_DETECT: 'off',
      GUESTFLOW_MAIL_OUTBOX: path.join(dir, 'outbox'), GUESTFLOW_PLUGINS: 'sources',
    },
    stdio: 'ignore',
  });
  return child;
}

async function waitUp(port) {
  for (let i = 0; i < 100; i += 1) {
    try { const r = await fetch(`http://127.0.0.1:${port}/api/version`); if (r.status) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server did not start');
}

const stop = (child) => new Promise((resolve) => { child.once('exit', resolve); child.kill(); });

test('rule 32 - private documents: anonymous callers get nothing, legacy files are moved at boot', { timeout: 60000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-docs-'));
  try {
    let port = await freePort();
    let child = boot(dir, port);
    await waitUp(port);
    await stop(child);

    const uploads = path.join(dir, 'uploads');
    const privateDocs = path.join(dir, 'private-documents');
    fs.mkdirSync(privateDocs, { recursive: true });
    fs.writeFileSync(path.join(uploads, '1700000000000-old.pdf'), 'legacy');
    fs.writeFileSync(path.join(privateDocs, '1800000000000-new.pdf'), 'private');
    fs.writeFileSync(path.join(uploads, 'photo.webp'), 'photo');
    const db = new Database(path.join(dir, 'g.db'));
    db.prepare("INSERT INTO properties (name) VALUES ('P')").run();
    const insert = db.prepare("INSERT INTO documents (propertyId, type, name, filePath) VALUES (1, 'contract', ?, ?)");
    insert.run('Ancien', '/uploads/1700000000000-old.pdf');
    insert.run('Nouveau', 'private/1800000000000-new.pdf');
    db.close();

    port = await freePort();
    child = boot(dir, port);
    await waitUp(port);
    // http.request keeps the path byte for byte (fetch would fold the dot segments away).
    const raw = (p) => new Promise((resolve, reject) => {
      http.request({ host: '127.0.0.1', port, path: p, method: 'GET' }, (res) => { res.resume(); resolve(res.statusCode); })
        .on('error', reject).end();
    });
    try {
      assert.equal(await raw('/uploads/1700000000000-old.pdf'), 404, 'the legacy file left the public tree');
      for (const trick of [
        '/uploads/_private/1800000000000-new.pdf', '/uploads/./_private/1800000000000-new.pdf',
        '/uploads/x/../_private/1800000000000-new.pdf', '/uploads/%2e/_private/1800000000000-new.pdf',
        '/uploads/x%2f..%2f_private/1800000000000-new.pdf', '/uploads/../private-documents/1800000000000-new.pdf',
        '/uploads/%2e%2e/private-documents/1800000000000-new.pdf', '/uploads/private-documents/1800000000000-new.pdf',
      ]) assert.notEqual(await raw(trick), 200, trick);
      assert.notEqual(await raw('/uploads/%E0'), 500, 'a malformed escape is a client error');
      assert.equal(await raw('/uploads/photo.webp'), 200, 'photos stay public');
      assert.equal(await raw('/api/properties/1/documents/1/file'), 401, 'anonymous download refused');
      assert.equal(await raw('/api/properties/1/documents/2/file'), 401);
    } finally {
      await stop(child);
    }
    assert.ok(fs.existsSync(path.join(privateDocs, '1700000000000-old.pdf')));
    assert.equal(fs.existsSync(path.join(uploads, '1700000000000-old.pdf')), false);
    const after = new Database(path.join(dir, 'g.db'), { readonly: true });
    assert.equal(after.prepare('SELECT filePath FROM documents WHERE id = 1').get().filePath, 'private/1700000000000-old.pdf');
    after.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rule 32 - private documents: model and controller', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-docs-unit-'));
  process.env.GUESTFLOW_UPLOADS_DIR = path.join(dir, 'uploads');
  process.env.DB_PATH = ':memory:';
  try {
    const db = require('../database');
    const model = require('../models/propertiesModel');
    const controller = require('../controllers/propertiesController');
    const files = require('../utils/propertyDocumentFiles');
    const pid = Number(db.prepare("INSERT INTO properties (name) VALUES ('Unit')").run().lastInsertRowid);
    const stored = path.join(files.ensurePrivateDir(), '1-contrat.pdf');
    fs.writeFileSync(stored, 'pdf');

    const added = model.addDocument(pid, { filename: '1-contrat.pdf', originalname: 'contrat.pdf' }, { type: 'contract', name: 'Contrat' });
    const docId = added.data.id;
    assert.equal(added.data.filePath, `/api/properties/${pid}/documents/${docId}/file`);
    assert.equal(db.prepare('SELECT filePath FROM documents WHERE id = ?').get(docId).filePath, 'private/1-contrat.pdf');
    assert.equal(model.getByIdWithDetails(pid).documents[0].filePath, `/api/properties/${pid}/documents/${docId}/file`, 'the stored path never reaches the client');

    const sent = {};
    controller.downloadDocument({ params: { id: String(pid), docId: String(docId) } }, {
      download(file, name) { sent.file = file; sent.name = name; },
      status(c) { sent.status = c; return this; }, json() { return this; },
    });
    assert.equal(sent.file, stored);
    assert.equal(sent.name, 'Contrat.pdf');
    const wrong = {};
    controller.downloadDocument({ params: { id: String(pid + 1), docId: String(docId) } }, { status(c) { wrong.status = c; return this; }, json() { return this; } });
    assert.equal(wrong.status, 404, 'a document is only reachable under its own property');

    model.deleteDocument(pid, docId);
    assert.equal(fs.existsSync(stored), false, 'the file goes with the row');
  } finally {
    delete process.env.GUESTFLOW_UPLOADS_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rule 32 - the move at boot: missing file logged, no overwrite, a retry recognises a file already in place', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-docs-move-'));
  process.env.GUESTFLOW_UPLOADS_DIR = path.join(dir, 'uploads');
  try {
    const files = require('../utils/propertyDocumentFiles');
    const uploads = path.join(dir, 'uploads');
    fs.mkdirSync(uploads, { recursive: true });
    const db = new Database(':memory:');
    db.exec('CREATE TABLE documents (id INTEGER PRIMARY KEY, propertyId INTEGER, type TEXT, name TEXT, filePath TEXT)');
    const add = db.prepare('INSERT INTO documents (id, propertyId, filePath) VALUES (?, 1, ?)');
    add.run(1, '/uploads/a.pdf'); add.run(2, '/uploads/gone.pdf'); add.run(3, '/uploads/same.pdf'); add.run(4, '/uploads/done.pdf');
    fs.writeFileSync(path.join(uploads, 'a.pdf'), 'A');
    fs.writeFileSync(path.join(uploads, 'same.pdf'), 'legacy');
    const priv = files.ensurePrivateDir();
    fs.writeFileSync(path.join(priv, 'same.pdf'), 'another file with the same name');
    fs.writeFileSync(path.join(priv, 'done.pdf'), 'moved before a crash');
    const warnings = [];
    assert.equal(files.moveLegacyDocumentsToPrivate(db, { warn: (m) => warnings.push(m) }), 3);
    const path_ = (id) => db.prepare('SELECT filePath FROM documents WHERE id = ?').get(id).filePath;
    assert.equal(path_(1), 'private/a.pdf');
    assert.equal(path_(2), '/uploads/gone.pdf', 'row left alone');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /gone\.pdf/);
    assert.equal(path_(3), 'private/3-same.pdf', 'never overwrites');
    assert.equal(fs.readFileSync(path.join(priv, 'same.pdf'), 'utf8'), 'another file with the same name');
    assert.equal(path_(4), 'private/done.pdf', 'a file already in place is recognised');
    assert.equal(files.moveLegacyDocumentsToPrivate(db, { warn() {} }), 0, 'a second run moves nothing');
    assert.equal(files.downloadName('Contrat', '/x/a.pdf'), 'Contrat.pdf');
    assert.equal(files.downloadName('Contrat.pdf', '/x/a.pdf'), 'Contrat.pdf');
  } finally {
    delete process.env.GUESTFLOW_UPLOADS_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
