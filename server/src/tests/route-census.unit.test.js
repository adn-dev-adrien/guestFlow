// specs/hosting-h2-account-security.md rule 68, census (2026-11-05) — the baselines are written by hand, so a new write route
// could miss them in silence. This walks the routers Express really mounted, core and plugins: each POST, PUT, PATCH, DELETE
// has a baseline row or an exemption with its reason. A router behind a wrapper function is not walked: website-booking's
// /public/v1 tree, judged by its public-input-shape suites.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./inputShapeApp');
const { baselines } = require('./inputShapeBaselines');
const { EXEMPT } = require('./routeCensusExempt');
const { PLUGIN_ROUTES, ownerOf } = require('./routeCensusOwners');
const { listPlugins } = require('../plugins/sdk/testing');

// Reading of 2026-11-05 (audit R24-S1): the census judges the plugins the tree ships. A route of a plugin taken out of
// the tree is neither stale nor missing, so its exemptions, baseline rows and samples are left out of every comparison.
const SHIPPED = new Set(listPlugins());
const shipped = (route) => { const owner = ownerOf(route); return !owner || SHIPPED.has(owner); };
const PLUGINS = ['hourly-resources', 'school-holidays', 'tariff-recipes', 'accounting-export', 'neat', 'online-payment', 'sas', 'linen', 'website-booking']
  .filter((id) => SHIPPED.has(id));

const asPattern = (route) => {
  const [method, path] = route.split(' ');
  return new RegExp(`^${method} ${path.replace(/:[A-Za-z_]+/g, '[^/]+')}$`);
};

let app;
let routes;
let rows;
let filed;

test.before(async () => {
  app = await startApp();
  const admin = await app.login('admin@shape.test');
  const active = await app.activatePlugins(admin, PLUGINS);
  routes = app.routes;
  filed = (await baselines(app, admin, active)).rows
    .map(([method, url, , options = {}]) => [`${method} ${typeof url === 'string' ? url : options.name}`.split('?')[0], options.plugin]);
  rows = filed.map(([row]) => row).filter((row) => shipped(routeOf(row)));
});
test.after(async () => { if (app) await app.stop(); });

// The route a baseline row runs, as the census writes it ('PUT /api/resource-bookings/7' → 'PUT /api/resource-bookings/:id').
const ALL_ROUTES = Object.values(PLUGIN_ROUTES).flat();
const routeOf = (row) => ALL_ROUTES.find((route) => route === row || asPattern(route).test(row)) || row;

const inTable = (route) => {
  const pattern = asPattern(route);
  return rows.some((row) => row === route || pattern.test(row));
};
const exempt = () => Object.values(EXEMPT).flat().filter(shipped);

test('census — the walk reads core routes and plugin routes', () => {
  for (const route of ['PUT /api/settings', 'POST /api/reservations', 'POST /api/resource-bookings', 'PUT /api/laundry/schedule', 'POST /api/reservations/:id/sas/arrival'].filter(shipped)) {
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

test('census — each plugin of the tree mounts exactly the routes listed under its id, and no listed route is core', () => {
  for (const id of listPlugins()) assert.deepEqual(app.pluginRoutes[id] || [], PLUGIN_ROUTES[id] || [], id);
  assert.deepEqual(Object.keys(PLUGIN_ROUTES).filter((id) => !app.pluginRoutes[id] && SHIPPED.has(id)), [], 'listed, shipped, never registered');
  const owned = new Set(Object.values(app.pluginRoutes).flat());
  assert.deepEqual(routes.filter((route) => ownerOf(route) && SHIPPED.has(ownerOf(route)) && !owned.has(route)), []);
});

test('census — a baseline row on a plugin route skips with that plugin', () => {
  assert.deepEqual(filed.filter(([row, plugin]) => ownerOf(routeOf(row)) && ownerOf(routeOf(row)) !== plugin), []);
});
