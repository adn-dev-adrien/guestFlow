// specs/hosting-h2-account-security.md rule 68, census (2026-11-05) — the baselines are written by hand, so a new write route
// could miss them in silence. This walks the routers Express really mounted, core and plugins: each POST, PUT, PATCH, DELETE
// has a baseline row or an exemption with its reason. A router behind a wrapper function is not walked: website-booking's
// /public/v1 tree, judged by its public-input-shape suites.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./inputShapeApp');
const { baselines } = require('./inputShapeBaselines');
const { EXEMPT } = require('./routeCensusExempt');

const PLUGINS = ['hourly-resources', 'school-holidays', 'tariff-recipes', 'accounting-export', 'neat', 'online-payment', 'sas', 'linen'];

const asPattern = (route) => {
  const [method, path] = route.split(' ');
  return new RegExp(`^${method} ${path.replace(/:[A-Za-z_]+/g, '[^/]+')}$`);
};

let app;
let routes;
let rows;

test.before(async () => {
  app = await startApp();
  const admin = await app.login('admin@shape.test');
  const active = await app.activatePlugins(admin, PLUGINS);
  routes = app.routes;
  rows = (await baselines(app, admin, active)).rows
    .map(([method, url, , options = {}]) => `${method} ${typeof url === 'string' ? url : options.name}`.split('?')[0]);
});
test.after(async () => { if (app) await app.stop(); });

const inTable = (route) => {
  const pattern = asPattern(route);
  return rows.some((row) => row === route || pattern.test(row));
};
const exempt = () => Object.values(EXEMPT).flat();

test('census — the walk reads core routes and plugin routes', () => {
  for (const route of ['PUT /api/settings', 'POST /api/reservations', 'POST /api/resource-bookings', 'PUT /api/laundry/schedule', 'POST /api/reservations/:id/sas/arrival']) {
    assert.ok(routes.includes(route), route);
  }
  assert.ok(routes.length > 200, `${routes.length} routes`);
});

test('census — every write route has a baseline row or a reason', () => {
  const listed = new Set(exempt());
  assert.deepEqual(routes.filter((route) => !inTable(route) && !listed.has(route)), []);
});

test('census — the list holds no stale entry and no route the table already runs', () => {
  const known = new Set(routes);
  assert.deepEqual(exempt().filter((route) => !known.has(route)), [], 'gone from the application');
  assert.deepEqual(exempt().filter(inTable), [], 'has a baseline row');
  assert.equal(new Set(exempt()).size, exempt().length, 'listed twice');
});

test('census — a baseline row names a route that exists', () => {
  const patterns = routes.map(asPattern);
  assert.deepEqual(rows.filter((row) => !routes.includes(row) && !patterns.some((pattern) => pattern.test(row))), []);
});
