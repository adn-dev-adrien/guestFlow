const test = require('node:test');
const assert = require('node:assert/strict');

const { buildServer } = require('../utils/httpsBootstrap');

// TLS is terminated by the Caddy reverse proxy at the edge (specs/reverse-proxy-caddy.md); the app
// always serves plain HTTP. These tests pin that the boot wiring builds an HTTP server without
// opening a socket, by injecting a fake `http` impl.

function fakeHttp(label) {
  return { createServer: (app) => ({ __kind: label, app }) };
}

const fakeApp = { __app: true };

test('buildServer: always builds a plain HTTP server (no TLS termination in the app)', () => {
  const { server, protocol } = buildServer({
    app: fakeApp,
    httpImpl: fakeHttp('plain-http'),
  });
  assert.equal(protocol, 'http');
  assert.equal(server.__kind, 'plain-http');
  assert.equal(server.app, fakeApp);
});

test('buildServer: requires an app', () => {
  assert.throws(() => buildServer({}), /requires an Express app/);
});
