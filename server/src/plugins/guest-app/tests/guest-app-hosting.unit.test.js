// specs/guest-app.md rules 47, 52 (plan step 50) — the plugin serves its two builds itself: the guest app on the guest
// host (hashed bundles immutable, index / service worker / manifest revalidated, every route of the app its index,
// a missing file 404, nothing outside the build), with a policy that lets in only itself and, while « Intégrer dans
// l'app » is on, the Soliomap frame (rule 15); the studio at /studio for an admin session only; a build not there → 503.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');

const {
  adminOnly, distDirOf, guestCsp, soliomapFrameOrigin, staticApp, studioCsp,
} = require('../appHosting');

function fixtureDist() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guest-dist-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.mkdirSync(path.join(dir, 'icons'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>Mon séjour</title>');
  fs.writeFileSync(path.join(dir, 'sw.js'), 'self.addEventListener("fetch", () => {});');
  fs.writeFileSync(path.join(dir, 'assets', 'index-3f9a.js'), 'console.log(1)');
  fs.writeFileSync(path.join(dir, 'icons', 'icon-192.png'), 'png');
  fs.writeFileSync(path.join(path.dirname(dir), 'secret.txt'), 'outside');
  return dir;
}

async function serve(handler, { session = null, base = '' } = {}) {
  const app = express();
  app.use((req, res, next) => { req.session = session; next(); });
  app.use((req, res, next) => (base && !req.path.startsWith(base) ? next() : handler(req, res, next)));
  app.use((req, res) => res.status(418).send('fell through'));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const url = `http://127.0.0.1:${server.address().port}`;
  return { get: (p, init) => fetch(`${url}${p}`, { redirect: 'manual', ...init }), close: () => new Promise((r) => { server.close(r); }) };
}

test('rule 52: the guest build — immutable bundles, revalidated shell, the app\'s routes on its index, missing files 404', async () => {
  const dir = fixtureDist();
  const site = await serve(staticApp({ dir: () => dir, csp: () => guestCsp() }));
  try {
    const bundle = await site.get('/assets/index-3f9a.js');
    assert.equal(bundle.status, 200);
    assert.equal(bundle.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal((await site.get('/sw.js')).headers.get('cache-control'), 'no-cache');
    assert.equal((await site.get('/icons/icon-192.png')).headers.get('cache-control'), 'public, max-age=86400');
    for (const route of ['/', '/s/abcDEF123', '/l/xyz', '/retrouver', '/commande/12', '/livret/depart']) {
      // eslint-disable-next-line no-await-in-loop
      const page = await site.get(route);
      assert.equal(page.status, 200, route);
      assert.equal(page.headers.get('cache-control'), 'no-cache', route);
      // eslint-disable-next-line no-await-in-loop
      assert.match(await page.text(), /Mon séjour/, route);
    }
    assert.equal((await site.get('/assets/missing-1.js')).status, 404);
    assert.equal((await site.get('/%2e%2e/secret.txt')).status, 404, 'nothing outside the build');
    assert.equal((await site.get('/', { method: 'POST' })).status, 418, 'only reads are the app\'s');
  } finally {
    await site.close();
  }
});

test('rule 49: the studio frames its own phone preview, and nothing else frames it or is framed by it', () => {
  assert.match(studioCsp(), /frame-src 'self'/);
  assert.match(studioCsp(), /frame-ancestors 'self'/);
  assert.doesNotMatch(studioCsp(), /'none'.*frame|frame-src 'none'/);
  assert.match(studioCsp(), /script-src 'self'/);
  assert.match(guestCsp(), /frame-ancestors 'none'/, 'the guest app is still framed by nobody');
});

test('rule 52: a build installed under a hidden folder (a worktree, ~/.local) is still served; a dot-file in it is not', async () => {
  const hidden = fs.mkdtempSync(path.join(os.tmpdir(), '.hidden-'));
  const dir = path.join(hidden, 'dist');
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>Mon séjour</title>');
  fs.writeFileSync(path.join(dir, 'assets', 'index-1.js'), 'console.log(1)');
  fs.writeFileSync(path.join(dir, '.env'), 'SECRET=1');
  const site = await serve(staticApp({ dir: () => dir, csp: () => guestCsp() }));
  try {
    assert.equal((await site.get('/')).status, 200);
    assert.equal((await site.get('/s/abc')).status, 200);
    assert.equal((await site.get('/assets/index-1.js')).status, 200);
    assert.notEqual((await site.get('/.env')).status, 200);
  } finally {
    await site.close();
  }
});

test('rule 15: the policy lets in the app itself only, and the Soliomap origin as a frame only while « Intégrer dans l\'app » is on', async () => {
  assert.match(guestCsp(), /frame-src 'none'/);
  assert.match(guestCsp(), /default-src 'self'.*script-src 'self'/);
  assert.match(guestCsp(), /frame-ancestors 'none'/);
  assert.equal(soliomapFrameOrigin({ soliomapUrl: 'https://map.domainesolio.com/', soliomapEmbed: '0' }), null);
  assert.equal(soliomapFrameOrigin({ soliomapUrl: 'https://map.domainesolio.com/', soliomapEmbed: '1' }), 'https://map.domainesolio.com');
  assert.equal(soliomapFrameOrigin({ soliomapUrl: 'http://map.example.test', soliomapEmbed: '1' }), null);
  const dir = fixtureDist();
  const site = await serve(staticApp({ dir: () => dir, csp: () => guestCsp({ frameOrigin: 'https://map.domainesolio.com' }) }));
  try {
    assert.match((await site.get('/')).headers.get('content-security-policy'), /frame-src https:\/\/map\.domainesolio\.com/);
  } finally {
    await site.close();
  }
});

test('rule 52: a build not there answers a plain 503; the builds are found in the package, else in the repository', async () => {
  const site = await serve(staticApp({ dir: () => null, csp: () => guestCsp() }));
  try {
    const res = await site.get('/s/abc');
    assert.equal(res.status, 503);
    assert.match(await res.text(), /Application indisponible/);
  } finally {
    await site.close();
  }
  const dir = fixtureDist();
  assert.equal(distDirOf('guest', ['/nowhere', dir]), dir);
  assert.equal(distDirOf('guest', ['/nowhere']), null);
});

// The users the studio re-reads, as the core's `requireAuth` does: by id, from the database.
const USERS = {
  1: { id: 1, roles: ['admin'], isActive: true, mustChangePassword: false },
  2: { id: 2, roles: ['reception'], isActive: true, mustChangePassword: false },
  3: { id: 3, roles: ['admin'], isActive: false, mustChangePassword: false },
  4: { id: 4, roles: ['reception'], isActive: true, mustChangePassword: false },
  5: { id: 5, roles: ['admin'], isActive: true, mustChangePassword: true },
};
const revalidate = require('../../../middleware/requireAuth').createRevalidate({ findById: (id) => USERS[id] || null });

test('rule 47: the studio at /studio — no session → the GuestFlow login, another role → 403, an admin gets the app', async () => {
  const dir = fixtureDist();
  const handler = adminOnly(staticApp({ dir: () => dir, base: '/studio', csp: () => guestCsp() }), { revalidate });
  const anonymous = await serve(handler, { base: '/studio' });
  try {
    const res = await anonymous.get('/studio/pages');
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/login?next=%2Fstudio%2Fpages');
  } finally {
    await anonymous.close();
  }
  const reception = await serve(handler, { base: '/studio', session: { user: { id: 2, roles: ['reception'] } } });
  try {
    assert.equal((await reception.get('/studio')).status, 403);
  } finally {
    await reception.close();
  }
  const admin = await serve(handler, { base: '/studio', session: { user: { id: 1, roles: ['admin'] } } });
  try {
    assert.equal((await admin.get('/studio/assets/index-3f9a.js')).headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal((await admin.get('/studio/livret/12')).status, 200);
  } finally {
    await admin.close();
  }
});

test('rule 47: the studio re-reads its admin — deactivated, demoted or held to a password change, the old session’s snapshot opens nothing', async () => {
  const dir = fixtureDist();
  const handler = adminOnly(staticApp({ dir: () => dir, base: '/studio', csp: () => guestCsp() }), { revalidate });
  const as = async (user, check) => {
    let destroyed = false;
    const session = { user, destroy(cb) { destroyed = true; cb(); } };
    const server = await serve(handler, { base: '/studio', session });
    try {
      await check(await server.get('/studio'), () => destroyed);
    } finally {
      await server.close();
    }
  };
  await as({ id: 3, roles: ['admin'] }, (res, destroyed) => {
    assert.equal(res.status, 302, 'deactivated');
    assert.equal(destroyed(), true, 'its session is ended');
  });
  await as({ id: 4, roles: ['admin'] }, (res) => assert.equal(res.status, 403, 'demoted since the login'));
  await as({ id: 5, roles: ['admin'] }, (res) => assert.equal(res.status, 302, 'must change the password first'));
  await as({ id: 99, roles: ['admin'] }, (res) => assert.equal(res.status, 302, 'deleted'));
});
