// Audit 2026-10-28 (authz L2, injection #5) — property documents are private: stored outside the public
// /uploads tree, served only through the authenticated download route, deleted with their row, and the
// files uploaded before the audit are moved at boot. specs/settings-rationalization.md rule 32.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
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
    fs.mkdirSync(path.join(uploads, '_private'), { recursive: true });
    fs.writeFileSync(path.join(uploads, '1700000000000-old.pdf'), 'legacy');
    fs.writeFileSync(path.join(uploads, '_private', '1800000000000-new.pdf'), 'private');
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
    const get = (p) => fetch(`http://127.0.0.1:${port}${p}`, { redirect: 'manual' });
    try {
      assert.equal((await get('/uploads/1700000000000-old.pdf')).status, 404, 'the legacy file left the public tree');
      assert.equal((await get('/uploads/_private/1800000000000-new.pdf')).status, 404);
      assert.equal((await get('/uploads/%5Fprivate/1800000000000-new.pdf')).status, 404);
      assert.equal((await get('/uploads/photo.webp')).status, 200, 'photos stay public');
      assert.equal((await get('/api/properties/1/documents/1/file')).status, 401, 'anonymous download refused');
      assert.equal((await get('/api/properties/1/documents/2/file')).status, 401);
    } finally {
      await stop(child);
    }
    assert.ok(fs.existsSync(path.join(uploads, '_private', '1700000000000-old.pdf')));
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
