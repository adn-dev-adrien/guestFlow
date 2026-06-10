/**
 * Builds the Node server for the Express app at boot time.
 *
 * TLS is terminated by the reverse proxy (Caddy) at the network edge — the app itself ALWAYS
 * serves plain HTTP on its port and relies on `app.set('trust proxy', 1)` + the proxy's
 * `X-Forwarded-Proto` header to know the real public scheme. See specs/reverse-proxy-caddy.md.
 *
 * Kept as a thin seam (rather than inlined into index.js) so the boot wiring stays unit-testable:
 * tests inject a fake `http` impl to assert the server is built without opening a socket.
 */

const http = require('http');

/**
 * @param {object} options
 * @param {object} options.app — the Express app
 * @param {typeof http} [options.httpImpl] — injected for unit tests
 * @returns {{ server: http.Server, protocol: 'http' }}
 */
function buildServer({ app, httpImpl = http } = {}) {
  if (!app) throw new Error('buildServer requires an Express app');
  return { server: httpImpl.createServer(app), protocol: 'http' };
}

module.exports = { buildServer };
