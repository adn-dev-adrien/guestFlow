#!/usr/bin/env node
// The removal matrix's server (specs/plugin-removal-resilience.md rules 7-10, 15): the production
// build — built client, every plugin loaded from its package — on the seeded database of a cell,
// supervised like PM2 would (an exit starts it again). A plugin whose package was not built is
// reported `PACKAGE_MISSING`, its row still installed.
//
// Control endpoints (test only, on E2E_REMOVAL_PORT + 1):
//   POST /__control/restart   stop the server; the supervisor starts it again
//   POST /__control/passes    run every scheduled pass once (server/scripts/run-scheduled-passes.js)
//   GET  /__control/log       what the server wrote since it started, for the "no register failed" check
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.E2E_REMOVAL_PORT || 4400);
const WORK = process.env.REMOVAL_WORK;
if (!WORK) throw new Error('REMOVAL_WORK (the cell directory holding removal.db) is required');
const DB_PATH = path.join(WORK, 'removal.db');

const serverEnv = {
  ...process.env,
  PORT: String(PORT),
  NODE_ENV: 'test',
  DB_PATH,
  GUESTFLOW_PLUGINS: 'packages',
  GUESTFLOW_PLUGINS_DIST: path.join(ROOT, 'plugins-dist'),
  GUESTFLOW_CLIENT_DIR: path.join(ROOT, 'client', 'dist'),
  GUESTFLOW_SUPERVISED: '1',
  GUESTFLOW_SMTP_DETECT: 'off',
  // specs/e2e-playwright-smoke-suite.md rule 23 — no release check, no school-holidays sync.
  GUESTFLOW_DISABLE_OUTBOUND: '1',
  GUESTFLOW_SESSION_SECRET: 'e2e-removal-fixed-session-secret-not-for-prod-32b',
  GUESTFLOW_ENCRYPTION_KEY: 'ZTJlZml4ZWRlbmNyeXB0aW9ua2V5MTIzNDU2Nzg5MGE=',
  CORS_ORIGINS: `http://localhost:${PORT},http://127.0.0.1:${PORT}`,
  API_RATELIMIT_MAX: '100000',
  // The providers are unreachable on purpose: no cell depends on, or reaches, the outside world.
  QONTO_API_BASE: 'http://127.0.0.1:9',
  QONTO_OAUTH_BASE: 'http://127.0.0.1:9',
  NEAT_API_BASE: 'http://127.0.0.1:9',
};

let child = null;
let stopping = false;
let output = '';

function start() {
  output = '';
  child = spawn(process.execPath, ['src/index.js'], { cwd: path.join(ROOT, 'server'), env: serverEnv });
  const keep = (chunk) => { output += chunk.toString(); process.stdout.write(chunk); };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  child.on('exit', () => { if (!stopping) setTimeout(start, 200); });
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const json = (status, body) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  if (req.method === 'POST' && url.pathname === '/__control/restart') {
    child.kill('SIGTERM');
    return json(200, { ok: true });
  }
  if (req.method === 'POST' && url.pathname === '/__control/passes') {
    const run = spawnSync(process.execPath, ['scripts/run-scheduled-passes.js'], { cwd: path.join(ROOT, 'server'), env: serverEnv, encoding: 'utf8' });
    const last = run.stdout.trim().split('\n').pop();
    let parsed = null;
    try { parsed = JSON.parse(last); } catch { parsed = { ran: [], failed: { script: run.stderr.slice(-400) || run.stdout.slice(-400) } }; }
    return json(200, parsed);
  }
  if (url.pathname === '/__control/log') return json(200, { output });
  return json(404, {});
}).listen(PORT + 1, '127.0.0.1', start);

const stop = () => { stopping = true; if (child) child.kill('SIGTERM'); process.exit(0); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
if (!fs.existsSync(DB_PATH)) throw new Error(`${DB_PATH} does not exist: seed the cell first`);
