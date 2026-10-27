// specs/plugins-phase-2-hosts.md rules 30-31 — GuestFlow hands the admin what the WordPress plugin is
// given (its address, the public API key) and rotates the key on demand. Rule 24's key is otherwise
// untouched: the boot never rotates it.

const os = require('os');
const fs = require('fs');
const path = require('path');

// Before localEnv loads: its file lives in a scratch directory, never the real server/.env.local.
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-site-connection-'));
process.env.GUESTFLOW_LOCAL_ENV = path.join(DIR, '.env.local');
delete process.env.PUBLIC_API_KEY;

const test = require('node:test');
const assert = require('node:assert/strict');

const localEnv = require('../../../utils/localEnv');
const { buildSiteConnectionController, siteApiAddress } = require('../siteConnectionController');
const { forbiddenReason } = require('../../../utils/supportSessionPolicy');
const enforceRoleAccess = require('../../../middleware/enforceRoleAccess');
const websiteBooking = require('..');
const registry = require('../../sdk/registry');
const { createContext } = require('../../sdk/createContext');
const Database = require('better-sqlite3');

function call(handler, req = {}) {
  const out = { headers: {}, status: 200, body: null };
  const res = {
    set(name, value) { out.headers[name.toLowerCase()] = value; return this; },
    status(code) { out.status = code; return this; },
    json(body) { out.body = body; return this; },
  };
  handler({ protocol: 'https', get: (h) => (h === 'host' ? 'gf.example.fr' : undefined), ...req }, res);
  return out;
}

test('rule 30: the address and the key, never cached', () => {
  const controller = buildSiteConnectionController({
    publicUrl: () => 'https://guestflow.example.com/',
    ensureKey: () => 'the-key',
    rotateKey: () => 'unused',
  });
  const out = call(controller.get);
  assert.equal(out.headers['cache-control'], 'no-store');
  assert.deepEqual(out.body, { address: { value: 'https://guestflow.example.com', source: 'setting' }, apiKey: 'the-key', antiBot: null });
});

test('rule 30: no public URL → the browsing origin, flagged as a guess', () => {
  assert.deepEqual(siteApiAddress({ publicUrl: '', req: { protocol: 'http', get: () => 'localhost:4860' } }),
    { value: 'http://localhost:4860', source: 'request' });
  assert.deepEqual(siteApiAddress({ publicUrl: '', req: {} }), { value: '', source: 'none' });
});

test('rule 31: a new key replaces the old one in the env file and in the running process', () => {
  const first = localEnv.getOrCreateSecret('PUBLIC_API_KEY', 32);
  fs.appendFileSync(process.env.GUESTFLOW_LOCAL_ENV, 'OTHER_SECRET=kept\n');
  const next = localEnv.rotateSecret('PUBLIC_API_KEY', 32);
  assert.notEqual(next, first);
  assert.equal(process.env.PUBLIC_API_KEY, next);
  const file = fs.readFileSync(process.env.GUESTFLOW_LOCAL_ENV, 'utf8');
  assert.match(file, new RegExp(`^PUBLIC_API_KEY=${next.replace(/[+/=]/g, '\\$&')}$`, 'm'));
  assert.doesNotMatch(file, new RegExp(first.replace(/[+/=]/g, '\\$&')));
  assert.match(file, /^OTHER_SECRET=kept$/m);
  assert.equal(localEnv.getOrCreateSecret('PUBLIC_API_KEY', 32), next, 'the boot keeps the rotated key');
});

test('rule 31: a key set by the real environment is refused with 409, nothing written', () => {
  // Only the environment holds it (rule 32: a key .env.local also holds is the file's to rotate).
  const withoutKey = fs.readFileSync(process.env.GUESTFLOW_LOCAL_ENV, 'utf8')
    .split('\n').filter((line) => !line.startsWith('PUBLIC_API_KEY=')).join('\n');
  fs.writeFileSync(process.env.GUESTFLOW_LOCAL_ENV, withoutKey);
  const before = fs.readFileSync(process.env.GUESTFLOW_LOCAL_ENV, 'utf8');
  const saved = process.env.PUBLIC_API_KEY;
  process.env.PUBLIC_API_KEY = 'from-the-environment';
  try {
    assert.throws(() => localEnv.rotateSecret('PUBLIC_API_KEY', 32), { code: 'SECRET_FROM_ENVIRONMENT' });
    const controller = buildSiteConnectionController({
      publicUrl: () => '',
      ensureKey: () => process.env.PUBLIC_API_KEY,
      rotateKey: () => localEnv.rotateSecret('PUBLIC_API_KEY', 32),
    });
    const out = call(controller.regenerate);
    assert.equal(out.status, 409);
    assert.equal(out.body.error, 'KEY_FROM_ENVIRONMENT');
    assert.equal(process.env.PUBLIC_API_KEY, 'from-the-environment');
    assert.equal(fs.readFileSync(process.env.GUESTFLOW_LOCAL_ENV, 'utf8'), before);
  } finally {
    process.env.PUBLIC_API_KEY = saved;
  }
});

test('rules 30-31: both routes are declared by the plugin, admin-only, closed to a support session', () => {
  const routes = [];
  const secretRoutes = [];
  const noop = new Proxy(function noop() {}, { get: () => noop, apply: () => noop });
  const ctx = new Proxy({}, {
    get(_, key) {
      if (key === 'id') return 'website-booking';
      if (key === 'route') return (method, p) => routes.push(`${method} ${p}`);
      if (key === 'secretRoutes') return (entries) => secretRoutes.push(...entries);
      return noop;
    },
  });
  websiteBooking.register(ctx);
  assert.ok(routes.includes('get /api/settings/website-connection'));
  assert.ok(routes.includes('post /api/settings/website-connection/regenerate'));
  for (const p of ['/settings/website-connection', '/settings/website-connection/regenerate']) {
    assert.ok(secretRoutes.some((r) => r.re.test(p)), p);
  }

  for (const roles of [['reception'], ['accountant']]) {
    let passed = false;
    const res = { status() { return this; }, json() { return this; } };
    enforceRoleAccess({ user: { roles }, method: 'GET', path: '/settings/website-connection' }, res, () => { passed = true; });
    assert.equal(passed, false, roles.join());
  }

  // The plugin's declaration is the only source: the core policy holds no copy of these paths.
  registry.reset();
  assert.equal(forbiddenReason('GET', '/settings/website-connection'), null, 'nothing declared, nothing refused');
  websiteBooking.register(createContext('website-booking', { db: new Database(':memory:') }));
  assert.equal(forbiddenReason('GET', '/settings/website-connection'), 'credentials');
  assert.equal(forbiddenReason('GET', '/Settings/Website-Connection/'), 'credentials');
  assert.equal(forbiddenReason('POST', '/settings/website-connection/regenerate'), 'credentials');
  registry.reset();
});

test.after(() => fs.rmSync(DIR, { recursive: true, force: true }));
