const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { buildFaviconHandler, SUPPORTED_EXTENSIONS, CACHE_SECONDS } = require('../middleware/dynamicFavicon');

// Pure-handler tests with stubs for settingsModel + fs. The point of these is to pin BOTH the
// happy paths (serve the company logo at /favicon.ico) AND the security paths (path-traversal +
// missing-file + unknown-mime all fall through to next() so the bundled default favicon ships).
// This handler runs on every favicon request, so any regression here breaks all browser tabs.

const UPLOADS_DIR = '/srv/guestflow/uploads';

function fakeRes() {
  const headers = {};
  return {
    headers,
    sendFileCalls: [],
    setHeader(k, v) { headers[k.toLowerCase()] = v; },
    sendFile(p, cb) { this.sendFileCalls.push(p); if (cb) cb(); },
  };
}

function makeNext() {
  const calls = [];
  const fn = (err) => calls.push(err === undefined ? 'next()' : err);
  fn.calls = calls;
  return fn;
}

function makeFs(files) {
  return { existsSync: (p) => Object.prototype.hasOwnProperty.call(files, p) };
}

function makeSettings(rowOrThrow) {
  if (rowOrThrow instanceof Error) return { read() { throw rowOrThrow; } };
  return { read() { return rowOrThrow; } };
}

// ----- happy path -----

test('serves the company logo when configured + file exists + supported MIME', () => {
  const handler = buildFaviconHandler({
    settingsModel: makeSettings({ companyLogoPath: '/uploads/company-logo.png' }),
    uploadsDir: UPLOADS_DIR,
    fsImpl: makeFs({ [path.join(UPLOADS_DIR, 'company-logo.png')]: true }),
  });
  const res = fakeRes();
  const next = makeNext();
  handler({}, res, next);

  assert.equal(next.calls.length, 0, 'must NOT fall through');
  assert.equal(res.sendFileCalls.length, 1);
  assert.equal(res.sendFileCalls[0], path.join(UPLOADS_DIR, 'company-logo.png'));
  assert.equal(res.headers['content-type'], 'image/png');
  assert.equal(res.headers['cache-control'], `public, max-age=${CACHE_SECONDS}`);
});

test('every supported extension picks the right Content-Type', () => {
  for (const [ext, mime] of Object.entries(SUPPORTED_EXTENSIONS)) {
    const filename = `company-logo${ext}`;
    const handler = buildFaviconHandler({
      settingsModel: makeSettings({ companyLogoPath: `/uploads/${filename}` }),
      uploadsDir: UPLOADS_DIR,
      fsImpl: makeFs({ [path.join(UPLOADS_DIR, filename)]: true }),
    });
    const res = fakeRes();
    handler({}, res, makeNext());
    assert.equal(res.headers['content-type'], mime, `mime mismatch for ${ext}`);
  }
});

// ----- fall-through cases (browser then gets the bundled default favicon) -----

test('no logo configured (empty string) → next()', () => {
  const handler = buildFaviconHandler({
    settingsModel: makeSettings({ companyLogoPath: '' }),
    uploadsDir: UPLOADS_DIR,
    fsImpl: makeFs({}),
  });
  const res = fakeRes();
  const next = makeNext();
  handler({}, res, next);
  assert.equal(res.sendFileCalls.length, 0);
  assert.deepEqual(next.calls, ['next()']);
});

test('settings.read() returns null (DB not ready) → next() with no throw', () => {
  const handler = buildFaviconHandler({
    settingsModel: { read: () => null },
    uploadsDir: UPLOADS_DIR,
    fsImpl: makeFs({}),
  });
  const next = makeNext();
  handler({}, fakeRes(), next);
  assert.deepEqual(next.calls, ['next()']);
});

test('settings.read() THROWS → swallowed → next()', () => {
  const handler = buildFaviconHandler({
    settingsModel: makeSettings(new Error('SQLITE_BUSY')),
    uploadsDir: UPLOADS_DIR,
    fsImpl: makeFs({}),
  });
  const next = makeNext();
  // Critical: a transient settings model error must not turn the favicon endpoint into a 500.
  handler({}, fakeRes(), next);
  assert.deepEqual(next.calls, ['next()']);
});

test('logo path set but file missing on disk → next()', () => {
  const handler = buildFaviconHandler({
    settingsModel: makeSettings({ companyLogoPath: '/uploads/company-logo.png' }),
    uploadsDir: UPLOADS_DIR,
    fsImpl: makeFs({}), // no files
  });
  const next = makeNext();
  handler({}, fakeRes(), next);
  assert.deepEqual(next.calls, ['next()']);
});

test('unsupported extension (e.g. .pdf, .exe) → next()', () => {
  for (const filename of ['attack.pdf', 'logo.exe', 'logo']) {
    const handler = buildFaviconHandler({
      settingsModel: makeSettings({ companyLogoPath: `/uploads/${filename}` }),
      uploadsDir: UPLOADS_DIR,
      fsImpl: makeFs({ [path.join(UPLOADS_DIR, filename)]: true }),
    });
    const next = makeNext();
    handler({}, fakeRes(), next);
    assert.deepEqual(next.calls, ['next()'], filename);
  }
});

// ----- security: path traversal -----

test('path traversal attempts in companyLogoPath cannot escape uploadsDir', () => {
  // A tampered DB row trying to pull /etc/passwd, ../foo.png, an absolute path, etc.
  const attacks = [
    '/uploads/../../etc/passwd',
    '../etc/passwd',
    '/etc/passwd',
    '/uploads/..%2F..%2Fetc%2Fpasswd', // URL-encoded — basename treats verbatim, still goes nowhere
    '/uploads/.',
    '/uploads/..',
    '/uploads/',
    '',
  ];
  for (const attack of attacks) {
    const handler = buildFaviconHandler({
      settingsModel: makeSettings({ companyLogoPath: attack }),
      uploadsDir: UPLOADS_DIR,
      // Pretend the attacker target exists on disk — the handler should still refuse to serve it.
      fsImpl: { existsSync: () => true },
    });
    const res = fakeRes();
    const next = makeNext();
    handler({}, res, next);
    assert.equal(res.sendFileCalls.length, 0, `served on ${attack}`);
    assert.deepEqual(next.calls, ['next()'], `next() not called on ${attack}`);
  }
});

test('a logo path with directory components is reduced to its basename, then served from uploadsDir', () => {
  // Defense in depth — even if some future code stored a path with subfolders, only the basename
  // is looked up inside uploadsDir. We assert that and that no traversal happens.
  const handler = buildFaviconHandler({
    settingsModel: makeSettings({ companyLogoPath: 'a/b/c/company-logo.png' }),
    uploadsDir: UPLOADS_DIR,
    fsImpl: makeFs({ [path.join(UPLOADS_DIR, 'company-logo.png')]: true }),
  });
  const res = fakeRes();
  handler({}, res, makeNext());
  assert.equal(res.sendFileCalls[0], path.join(UPLOADS_DIR, 'company-logo.png'));
});

// ----- guard rails -----

test('factory throws when required deps are missing', () => {
  assert.throws(() => buildFaviconHandler({ uploadsDir: '/x' }), /settingsModel/);
  assert.throws(() => buildFaviconHandler({ settingsModel: { read: () => ({}) } }), /uploadsDir/);
});
