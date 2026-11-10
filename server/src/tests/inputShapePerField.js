// The per-field fuzz of specs/hosting-h2-account-security.md rule 68, shared by the files that split the route set
// (audit R36-S4): `npm test`'s --test-timeout also caps each file, so each file fuzzes a part of the rows and stays far
// under it. `part(path)` keeps the rows of one file; every row lands in exactly one file (a filter and its complement).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./inputShapeApp');
const { baselines, fuzzRow, junkScanner } = require('./inputShapeBaselines');

const T = JSON.parse('{"toString":1}');
const VALUES = [['T', T], ['obj', { a: 1 }], ['true', true], ['huge', 1e308], ['null', null]];
const PLUGINS = ['hourly-resources', 'school-holidays', 'tariff-recipes', 'accounting-export', 'neat', 'online-payment', 'sas', 'linen', 'website-booking'];

// The stays, their money and their logements in one file; everything else in the other.
const STAY_PREFIXES = ['/api/reservations', '/api/devis', '/api/payments', '/api/resource-bookings', '/api/properties'];
const routeOf = (row) => (typeof row[1] === 'string' ? row[1] : '');
const isStayRow = (row) => !routeOf(row) || STAY_PREFIXES.some((p) => routeOf(row) === p || routeOf(row).startsWith(`${p}/`));

function perFieldSuite({ part, minRequests }) {
  const state = {};
  test.before(async () => {
    state.app = await startApp();
    state.admin = await state.app.login('admin@shape.test');
    state.active = await state.app.activatePlugins(state.admin, PLUGINS);
    const { rows } = await baselines(state.app, state.admin, state.active);
    state.rows = rows.filter(([, , , options = {}]) => !options.plugin || state.active.has(options.plugin)).filter(part);
    state.scanner = junkScanner(state.app.dbPath);
  });
  test.after(async () => {
    if (state.scanner) state.scanner.close();
    if (state.app) await state.app.stop();
  });

  test('rule 68 — every baseline is accepted or stops only at the state it names', async () => {
    const failures = [];
    const dead = [];
    let requests = 0;
    for (const row of state.rows) {
      const result = await fuzzRow(state.app, state.admin, state.scanner, row, VALUES);
      requests += result.requests;
      failures.push(...result.failures);
      if (!result.reached) dead.push(`${row[0]} ${typeof row[1] === 'string' ? row[1] : row[3].name} → ${result.baseline} ${result.answer}`);
    }
    assert.ok(requests > minRequests, `${requests} requests`);
    assert.deepEqual(dead, []);
    assert.deepEqual([...new Set(failures)], []);
  });
  return state;
}

module.exports = { perFieldSuite, isStayRow, STAY_PREFIXES };
