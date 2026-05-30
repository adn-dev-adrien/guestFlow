const test = require('node:test');
const assert = require('node:assert/strict');

const { loadTlsMaterial, buildServer, DEFAULT_CERT_PATH, DEFAULT_KEY_PATH } = require('../utils/httpsBootstrap');

// Stub fs / http / https so we never read the disk or open a socket. The point of these tests is
// to pin the boot-time decision: which kind of server gets built, and what happens when the TLS
// material is missing.

function fakeFs({ files }) {
  return {
    existsSync(path) { return Object.prototype.hasOwnProperty.call(files, path); },
    readFileSync(path) {
      if (!Object.prototype.hasOwnProperty.call(files, path)) {
        const err = new Error(`ENOENT: no such file, open '${path}'`);
        err.code = 'ENOENT';
        throw err;
      }
      return Buffer.from(files[path]);
    },
  };
}

function fakeHttp(label) {
  return { createServer: (app) => ({ __kind: label, app }) };
}

function fakeHttps(label) {
  return {
    createServer: (opts, app) => ({ __kind: label, app, tls: opts }),
  };
}

const fakeApp = { __app: true };

// ----- loadTlsMaterial -----

test('loadTlsMaterial: reads both files via the injected fs + reports the resolved paths', () => {
  const fsImpl = fakeFs({
    files: {
      '/etc/guestflow/cert.pem': 'cert-bytes',
      '/etc/guestflow/key.pem': 'key-bytes',
    },
  });
  const tls = loadTlsMaterial({
    certPath: '/etc/guestflow/cert.pem',
    keyPath: '/etc/guestflow/key.pem',
    fsImpl,
  });
  assert.equal(tls.certPath, '/etc/guestflow/cert.pem');
  assert.equal(tls.keyPath, '/etc/guestflow/key.pem');
  assert.equal(tls.cert.toString(), 'cert-bytes');
  assert.equal(tls.key.toString(), 'key-bytes');
});

test('loadTlsMaterial: defaults to server/certs/server.{crt,key} when no overrides given', () => {
  // The defaults are exported so the deploy workflow / scripts can target the same paths.
  assert.ok(DEFAULT_CERT_PATH.endsWith('certs/server.crt'));
  assert.ok(DEFAULT_KEY_PATH.endsWith('certs/server.key'));
});

test('loadTlsMaterial: missing cert OR key → throws TLS_FILES_MISSING + names every missing path', () => {
  const fsImpl = fakeFs({ files: { '/only/key.pem': 'key' } });
  let caught;
  try {
    loadTlsMaterial({ certPath: '/only/cert.pem', keyPath: '/only/key.pem', fsImpl });
  } catch (err) { caught = err; }
  assert.ok(caught);
  assert.equal(caught.code, 'TLS_FILES_MISSING');
  assert.match(caught.message, /cert \(\/only\/cert\.pem\)/, 'cert path named in the message');
  // Key was present, so it must NOT be listed.
  assert.equal(/key \(\/only\/key\.pem\)/.test(caught.message), false);
  // Operator hint: point at the helper script + the HTTPS_ENABLED escape hatch.
  assert.match(caught.message, /generate-self-signed-cert\.sh/);
  assert.match(caught.message, /HTTPS_ENABLED/);
});

test('loadTlsMaterial: both files missing → both paths in the error', () => {
  const fsImpl = fakeFs({ files: {} });
  let caught;
  try {
    loadTlsMaterial({ certPath: '/x/cert', keyPath: '/x/key', fsImpl });
  } catch (err) { caught = err; }
  assert.ok(caught);
  assert.match(caught.message, /cert \(\/x\/cert\)/);
  assert.match(caught.message, /key \(\/x\/key\)/);
});

// ----- buildServer -----

test('buildServer: HTTPS_ENABLED=false → plain HTTP server, fs is never touched', () => {
  // The fs stub throws on any access so we prove buildServer doesn't read it.
  const fsImpl = { existsSync() { throw new Error('fs should not be touched'); } };
  const { server, protocol } = buildServer({
    httpsEnabled: false,
    app: fakeApp,
    fsImpl,
    httpImpl: fakeHttp('plain-http'),
    httpsImpl: fakeHttps('https'),
  });
  assert.equal(protocol, 'http');
  assert.equal(server.__kind, 'plain-http');
  assert.equal(server.app, fakeApp);
});

test('buildServer: HTTPS_ENABLED=true + cert+key present → https server with the loaded material', () => {
  const fsImpl = fakeFs({ files: { '/c/cert': 'CERT', '/c/key': 'KEY' } });
  const { server, protocol, tlsInfo } = buildServer({
    httpsEnabled: true,
    app: fakeApp,
    certPath: '/c/cert',
    keyPath: '/c/key',
    fsImpl,
    httpImpl: fakeHttp('plain-http'),
    httpsImpl: fakeHttps('https'),
  });
  assert.equal(protocol, 'https');
  assert.equal(server.__kind, 'https');
  assert.equal(server.app, fakeApp);
  assert.equal(server.tls.cert.toString(), 'CERT');
  assert.equal(server.tls.key.toString(), 'KEY');
  assert.deepEqual(tlsInfo, { certPath: '/c/cert', keyPath: '/c/key' });
});

test('buildServer: HTTPS_ENABLED=true + missing cert → throws TLS_FILES_MISSING (no silent HTTP downgrade)', () => {
  const fsImpl = fakeFs({ files: {} });
  let caught;
  try {
    buildServer({
      httpsEnabled: true,
      app: fakeApp,
      certPath: '/missing/cert',
      keyPath: '/missing/key',
      fsImpl,
      httpImpl: fakeHttp('plain-http'),
      httpsImpl: fakeHttps('https'),
    });
  } catch (err) { caught = err; }
  assert.ok(caught);
  assert.equal(caught.code, 'TLS_FILES_MISSING');
  // Critical safety: we must NOT have built an HTTP server as a fallback. If we did, callers
  // would silently leak a Secure cookie over plain transport. The hard error stops that.
});

test('buildServer: requires an app', () => {
  assert.throws(() => buildServer({ httpsEnabled: false }), /requires an Express app/);
});

// ----- Integration with env vars -----

test('loadTlsMaterial: TLS_CERT_PATH / TLS_KEY_PATH env vars override the defaults', () => {
  const originalCert = process.env.TLS_CERT_PATH;
  const originalKey = process.env.TLS_KEY_PATH;
  try {
    process.env.TLS_CERT_PATH = '/env/cert.pem';
    process.env.TLS_KEY_PATH = '/env/key.pem';
    const fsImpl = fakeFs({ files: { '/env/cert.pem': 'C', '/env/key.pem': 'K' } });
    const tls = loadTlsMaterial({ fsImpl });
    assert.equal(tls.certPath, '/env/cert.pem');
    assert.equal(tls.keyPath, '/env/key.pem');
  } finally {
    if (originalCert === undefined) delete process.env.TLS_CERT_PATH; else process.env.TLS_CERT_PATH = originalCert;
    if (originalKey === undefined) delete process.env.TLS_KEY_PATH; else process.env.TLS_KEY_PATH = originalKey;
  }
});
