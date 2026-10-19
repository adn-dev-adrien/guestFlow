#!/usr/bin/env node
// The production-build E2E harness (specs/plugins-phase-4-registry.md rule 19).
//
//   - the GuestFlow server serves the built client (client/dist) and loads every plugin from the
//     packages of plugins-dist/, as a release does (GUESTFLOW_PLUGINS=packages);
//   - it is supervised like PM2 would: when it exits (a plugin update restarts it, rule 13) it is
//     started again on the same database;
//   - a test registry signs its index with a throwaway Ed25519 key and serves packages built from
//     plugins-dist/ with a bumped version. It starts empty; the global setup publishes into it.
//
// Control endpoints (test only, on the registry port):
//   POST /__control/publish  { id, version, lines, badHash }  re-pack plugins-dist/<id> as <version>
//   POST /__control/restart                                   restart GuestFlow (after the seed)
//
// Ports: E2E_PROD_PORT (GuestFlow, default 4300), E2E_REGISTRY_PORT (default 4301).
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.E2E_PROD_PORT || 4300);
const REGISTRY_PORT = Number(process.env.E2E_REGISTRY_PORT || 4301);
// A fresh data directory per run: the database, the packages installed from the registry, plugin-data.
const DATA = path.join(os.tmpdir(), `gf-e2e-prod-${PORT}`);
fs.rmSync(DATA, { recursive: true, force: true });
fs.mkdirSync(DATA, { recursive: true });
const DIST = path.join(ROOT, 'plugins-dist');

if (!fs.existsSync(path.join(DIST, 'SHA256SUMS'))) execFileSync('node', ['scripts/build-plugin-packages.mjs'], { cwd: ROOT, stdio: 'inherit' });
if (!fs.existsSync(path.join(ROOT, 'client', 'dist', 'index.html'))) execFileSync('npm', ['run', 'build'], { cwd: path.join(ROOT, 'client'), stdio: 'inherit' });

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const packages = {}; // file name → buffer
const index = { format: 1, plugins: {} };
let indexBytes = Buffer.from(JSON.stringify(index));
const sign = () => {
  index.generatedAt = new Date().toISOString();
  indexBytes = Buffer.from(JSON.stringify(index));
  return crypto.sign(null, indexBytes, privateKey).toString('base64');
};
let signature = sign();

function publish({ id, version, lines = [], badHash = false }) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-e2e-pkg-'));
  fs.cpSync(path.join(DIST, id), work, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(work, 'manifest.json'), 'utf8'));
  manifest.version = version;
  manifest.changelog = { ...manifest.changelog, [version]: lines.length ? lines : [`Version ${version}.`] };
  fs.writeFileSync(path.join(work, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const file = path.join(work, 'pkg.tgz');
  execFileSync('tar', ['-czf', file, '-C', work, 'manifest.json', 'server', 'client'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  const buf = fs.readFileSync(file);
  fs.rmSync(work, { recursive: true, force: true });
  packages[`${id}-${version}.tgz`] = buf;
  const sha = crypto.createHash('sha256').update(badHash ? Buffer.from('not this package') : buf).digest('hex');
  index.plugins[id] = [...(index.plugins[id] || []).filter((v) => v.version !== version),
    { version, sha256: sha, size: buf.length, manifest, publishedAt: new Date().toISOString() }];
  signature = sign();
}

let child = null;
let stopping = false;
function startServer() {
  child = spawn(process.execPath, ['src/index.js'], {
    cwd: path.join(ROOT, 'server'),
    stdio: 'inherit',
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'test',
      DB_PATH: path.join(DATA, 'guestflow.db'),
      GUESTFLOW_PLUGINS: 'packages',
      GUESTFLOW_PLUGINS_DIST: DIST,
      GUESTFLOW_CLIENT_DIR: path.join(ROOT, 'client', 'dist'),
      GUESTFLOW_SUPERVISED: '1',
      // specs/settings-rationalization.md rule 28 — no real DNS lookup of a sending domain.
      GUESTFLOW_SMTP_DETECT: 'off',
      GUESTFLOW_REGISTRY_URL: `http://127.0.0.1:${REGISTRY_PORT}/registry/v1`,
      GUESTFLOW_REGISTRY_PUBLIC_KEY: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
      GUESTFLOW_SESSION_SECRET: 'e2e-prod-fixed-session-secret-not-for-prod-32b',
      GUESTFLOW_ENCRYPTION_KEY: 'ZTJlZml4ZWRlbmNyeXB0aW9ua2V5MTIzNDU2Nzg5MGE=',
      CORS_ORIGINS: `http://localhost:${PORT},http://127.0.0.1:${PORT}`,
    },
  });
  child.on('exit', () => { if (!stopping) setTimeout(startServer, 200); });
}

const readBody = (req) => new Promise((resolve) => {
  let data = '';
  req.on('data', (c) => { data += c; });
  req.on('end', () => resolve(data ? JSON.parse(data) : {}));
});

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname === '/__control/publish') {
    publish(await readBody(req));
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    return;
  }
  if (req.method === 'POST' && url.pathname === '/__control/restart') {
    child.kill('SIGTERM');
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    return;
  }
  if (url.pathname === '/registry/v1/index.json') { res.writeHead(200, { 'content-type': 'application/json' }).end(indexBytes); return; }
  if (url.pathname === '/registry/v1/index.json.sig') { res.writeHead(200, { 'content-type': 'text/plain' }).end(signature); return; }
  const m = url.pathname.match(/^\/registry\/v1\/packages\/([^/]+)$/);
  if (m && packages[m[1]]) { res.writeHead(200, { 'content-type': 'application/gzip' }).end(packages[m[1]]); return; }
  res.writeHead(404).end();
}).listen(REGISTRY_PORT, '127.0.0.1', startServer);

const stop = () => { stopping = true; if (child) child.kill('SIGTERM'); process.exit(0); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
