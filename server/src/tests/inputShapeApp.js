// Starts inputShapeAppChild.js on a free port and speaks to it as a browser does, with a session cookie.
const { fork } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

async function startApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-input-shape-'));
  fs.mkdirSync(path.join(dir, 'uploads'));
  fs.mkdirSync(path.join(dir, 'outbox'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = fork(path.join(__dirname, 'inputShapeAppChild.js'), [], {
    silent: true,
    execArgv: [],
    env: {
      PATH: process.env.PATH,
      TZ: 'Europe/Paris',
      NODE_ENV: 'test',
      GUESTFLOW_DISABLE_OUTBOUND: '1',
      DB_PATH: path.join(dir, 'g.db'),
      GUESTFLOW_UPLOADS_DIR: path.join(dir, 'uploads'),
      GUESTFLOW_LOCAL_ENV: path.join(dir, '.env.local'),
      GUESTFLOW_PLUGINS: 'sources',
      PORT: String(port),
      GUESTFLOW_LISTEN_HOST: '127.0.0.1',
      GUESTFLOW_MAIL_OUTBOX: path.join(dir, 'outbox'),
      GUESTFLOW_SMTP_DETECT: 'off',
      GUESTFLOW_PUBLIC_URL: base,
      QONTO_API_BASE: 'http://127.0.0.1:9',
      QONTO_OAUTH_BASE: 'http://127.0.0.1:9',
      NEAT_API_BASE: 'http://127.0.0.1:9',
      API_RATELIMIT_MAX: '1000000',
      LOGIN_RATELIMIT_MAX: '1000000',
    },
  });
  const log = [];
  child.stdout.on('data', (chunk) => log.push(String(chunk)));
  child.stderr.on('data', (chunk) => log.push(String(chunk)));
  const seed = await new Promise((resolve, reject) => {
    child.once('message', resolve);
    child.once('exit', (code) => reject(new Error(`the app stopped (${code}): ${log.join('').slice(-2000)}`)));
  });
  for (let i = 0; i < 100; i += 1) {
    const up = await fetch(`${base}/api/version`).then((r) => r.ok, () => false);
    if (up) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  async function call(cookie, method, url, body, headers = {}) {
    const res = await fetch(base + url, {
      method,
      redirect: 'manual',
      headers: { 'content-type': 'application/json', origin: base, ...(cookie ? { cookie } : {}), ...headers },
      body: body === undefined ? undefined : (typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, json, text, setCookie: res.headers.getSetCookie() };
  }

  async function login(email) {
    const res = await call('', 'POST', '/api/auth/login', { email, password: seed.password });
    if (res.status !== 200) throw new Error(`login ${email}: ${res.status} ${res.text}`);
    return res.setCookie.map((c) => c.split(';')[0]).join('; ');
  }

  // Installs and switches on each plugin the tree ships; a plugin the app does not know is left out of the returned set
  // (plugin-removal-resilience). A plugin that is present and refuses to start fails the suite.
  async function activatePlugins(cookie, ids) {
    const active = new Set();
    for (const id of ids) {
      const install = await call(cookie, 'POST', `/api/plugins/${id}/install`, {});
      if (install.status === 404 && install.json && install.json.error === 'UNKNOWN_PLUGIN') continue;
      const activate = install.status < 300 ? await call(cookie, 'POST', `/api/plugins/${id}/activate`, {}) : install;
      if (activate.status >= 300) throw new Error(`${id}: ${activate.status} ${activate.text.slice(0, 200)}`);
      active.add(id);
    }
    return active;
  }

  return {
    ...seed,
    base,
    call,
    login,
    activatePlugins,
    readDb: (sql, ...params) => {
      const Database = require('better-sqlite3');
      const ro = new Database(path.join(dir, 'g.db'), { readonly: true });
      try { return ro.prepare(sql).all(...params); } finally { ro.close(); }
    },
    logSince: (mark) => log.join('').slice(mark),
    logMark: () => log.join('').length,
    stop: () => new Promise((resolve) => {
      child.removeAllListeners('exit');
      child.once('exit', () => {
        fs.rmSync(dir, { recursive: true, force: true });
        resolve();
      });
      child.kill('SIGKILL');
    }),
  };
}

module.exports = { startApp };
