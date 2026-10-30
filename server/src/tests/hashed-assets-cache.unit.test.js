const { listenLocal } = require('./listenLocal');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const hashedAssets = require('../middleware/hashedAssets');

// specs/inte-performance.md rule 7 — a content-hashed file is cached for a year; the page that names
// it (index.html) is still revalidated.

async function withClient(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hashed-assets-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'assets', 'App-abc123.js'), 'export default 1;');
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html>');
  const app = express();
  app.use('/assets', hashedAssets(dir));
  app.use(express.static(dir));
  const server = await listenLocal(app);
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections();
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('rule 7: a file under /assets is cached for a year and immutable', async () => {
  await withClient(async (base) => {
    const res = await fetch(`${base}/assets/App-abc123.js`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  });
});

test('rule 7: index.html is not immutable, a missing asset is not served as one', async () => {
  await withClient(async (base) => {
    const page = await fetch(`${base}/index.html`);
    assert.equal(page.headers.get('cache-control'), 'public, max-age=0');
    const missing = await fetch(`${base}/assets/gone-abc123.js`);
    assert.equal(missing.status, 404);
    assert.ok(!(missing.headers.get('cache-control') || '').includes('immutable'));
  });
});
