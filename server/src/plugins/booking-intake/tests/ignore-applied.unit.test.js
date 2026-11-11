// specs/booking-extranet-intake.md rule 39 (audit R42 plugins, 2026-11-10) — « Ignorer » answers a proposal only, as
// « Appliquer » does. A stale second tab used to turn an applied intake into « ignoré » and drop the fiche's « Rempli
// depuis l'extranet » banner. Already applied or ignored → 409, unknown → 404, nothing changed.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const Database = require('better-sqlite3');

const { buildModel, TABLE_SQL } = require('../intakesModel');
const { createIntakeService } = require('../intakeService');
const { adminRouter } = require('../routes');

function setup() {
  const db = new Database(':memory:');
  db.exec(TABLE_SQL);
  const intakes = buildModel(db);
  const service = createIntakeService({
    intakes, hotelIds: () => ({}), findReservations: () => [], getReservation: () => null, clientShared: () => false, core: {},
    today: () => new Date().toISOString().slice(0, 10),
  });
  return { intakes, service };
}

async function serve(service) {
  const app = express();
  app.use('/api/booking-intake', adminRouter({ service: () => service, pending: () => [], dismissFiche: () => true, intakeLog: () => [] }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/booking-intake`;
  return { post: (path) => fetch(base + path, { method: 'POST' }), close: () => new Promise((resolve) => server.close(resolve)) };
}

test('rule 39 — « Ignorer » on an applied intake is 409, the intake and its banner kept', async (t) => {
  const { intakes, service } = setup();
  const id = intakes.insert({ resId: '1', hotelId: 'h', reservationId: 5, status: 'applied', parsed: { booking: {} } });
  const s = await serve(service);
  t.after(s.close);
  const res = await s.post(`/${id}/ignore`);
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { error: 'Proposition déjà traitée.' });
  assert.equal(intakes.get(id).status, 'applied');
  assert.equal(service.blockFor(5).status, 'applied');
});

test('rule 39 — an intake already ignored is 409, an id that names nothing is 404', async (t) => {
  const { intakes, service } = setup();
  const id = intakes.insert({ resId: '2', hotelId: 'h', reservationId: 6, status: 'ignored', parsed: { booking: {} } });
  const s = await serve(service);
  t.after(s.close);
  assert.equal((await s.post(`/${id}/ignore`)).status, 409);
  assert.equal(intakes.get(id).status, 'ignored');
  assert.equal((await s.post('/99999/ignore')).status, 404);
});

test('rule 39 — a proposal is still ignored', async (t) => {
  const { intakes, service } = setup();
  const id = intakes.insert({ resId: '3', hotelId: 'h', reservationId: 7, status: 'proposed', parsed: { booking: {}, differences: [] } });
  const s = await serve(service);
  t.after(s.close);
  const res = await s.post(`/${id}/ignore`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(intakes.get(id).status, 'ignored');
});
