/**
 * Picks the right server (plain HTTP or HTTPS) at boot time based on the env flags. Extracted
 * from index.js so the decision logic is testable + the failure modes are explicit.
 *
 * Rules:
 *   HTTPS_ENABLED unset/false  → plain HTTP server.
 *   HTTPS_ENABLED=true         → loads cert+key from TLS_CERT_PATH / TLS_KEY_PATH (or the
 *                                defaults under `server/certs/`) and returns an HTTPS server.
 *                                If either file is missing, throws a HARD error at boot — better
 *                                to refuse to start than to silently fall back to HTTP and leak
 *                                a cookie/session over plain transport.
 *
 * The caller passes its Express `app` and gets back a Node `http.Server` or `https.Server`
 * (`.listen()` is the same on both). Production wires this directly; tests stub `fs.readFileSync`
 * to verify both branches without touching the disk.
 */

const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

const DEFAULT_CERT_PATH = path.join(__dirname, '..', '..', 'certs', 'server.crt');
const DEFAULT_KEY_PATH = path.join(__dirname, '..', '..', 'certs', 'server.key');

/**
 * Loads the TLS material from disk. Exposed for direct testing.
 *
 * @param {object} options
 * @param {string} [options.certPath]
 * @param {string} [options.keyPath]
 * @param {typeof fs} [options.fsImpl] — injected for unit tests
 * @returns {{ cert: Buffer, key: Buffer, certPath: string, keyPath: string }}
 * @throws {Error} with `.code === 'TLS_FILES_MISSING'` when either file is absent
 *                + a message naming the missing path and pointing at the helper script.
 */
function loadTlsMaterial({ certPath, keyPath, fsImpl = fs } = {}) {
  const certResolved = certPath || process.env.TLS_CERT_PATH || DEFAULT_CERT_PATH;
  const keyResolved = keyPath || process.env.TLS_KEY_PATH || DEFAULT_KEY_PATH;

  const missing = [];
  if (!fsImpl.existsSync(certResolved)) missing.push(`cert (${certResolved})`);
  if (!fsImpl.existsSync(keyResolved)) missing.push(`key (${keyResolved})`);
  if (missing.length > 0) {
    const err = new Error(
      `TLS material missing: ${missing.join(', ')}. `
      + 'Either generate a self-signed cert with `server/scripts/generate-self-signed-cert.sh`, '
      + 'or unset HTTPS_ENABLED to fall back to plain HTTP.'
    );
    err.code = 'TLS_FILES_MISSING';
    throw err;
  }

  return {
    cert: fsImpl.readFileSync(certResolved),
    key: fsImpl.readFileSync(keyResolved),
    certPath: certResolved,
    keyPath: keyResolved,
  };
}

/**
 * Builds the appropriate server for the given Express app. The caller decides when to `.listen()`.
 *
 * @param {object} options
 * @param {boolean} options.httpsEnabled
 * @param {object} options.app — the Express app
 * @param {string} [options.certPath]
 * @param {string} [options.keyPath]
 * @param {typeof fs} [options.fsImpl]
 * @param {typeof http} [options.httpImpl]
 * @param {typeof https} [options.httpsImpl]
 * @returns {{ server: http.Server | https.Server, protocol: 'http' | 'https', tlsInfo?: object }}
 */
function buildServer({
  httpsEnabled,
  app,
  certPath,
  keyPath,
  fsImpl = fs,
  httpImpl = http,
  httpsImpl = https,
} = {}) {
  if (!app) throw new Error('buildServer requires an Express app');
  if (!httpsEnabled) {
    return { server: httpImpl.createServer(app), protocol: 'http' };
  }
  const tls = loadTlsMaterial({ certPath, keyPath, fsImpl });
  const server = httpsImpl.createServer({ cert: tls.cert, key: tls.key }, app);
  return {
    server,
    protocol: 'https',
    tlsInfo: { certPath: tls.certPath, keyPath: tls.keyPath },
  };
}

module.exports = {
  DEFAULT_CERT_PATH,
  DEFAULT_KEY_PATH,
  loadTlsMaterial,
  buildServer,
};
