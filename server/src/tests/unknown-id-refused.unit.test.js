// specs/reservations-backend-mvc.md rule 26 (audit R40-RES-L1, 2026-11-10) — an id that passes the shape check but
// names no row is refused before it reaches a foreign-key INSERT (each was a 500 « Erreur interne du serveur »):
// a devis naming an unknown client → 400 CLIENT_REQUIRED, as a stay; calculate-price and a calendar note on an
// unknown logement → 404 « Logement non trouvé », as suggest-beds. Nothing is written.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./reservationSaveFixture');
const devisController = require('../controllers/devisController');
const calendarNotesController = require('../controllers/calendarNotesController');
const { todayIso } = require('../utils/localDate');

function call(handler, req) {
  const res = f.respond();
  const out = handler({ user: f.ADMIN, params: {}, query: {}, ...req }, res);
  return out && typeof out.then === 'function' ? out.then(() => res) : res;
}
const count = (sql) => f.db.prepare(sql).get().n;

test.before(() => f.seed());

test('rule 26: a devis created with a client that does not exist → 400 CLIENT_REQUIRED, nothing written', () => {
  const before = count("SELECT COUNT(*) AS n FROM reservations WHERE kind = 'devis'");
  const res = call(devisController.create, { body: f.stayBody({ clientId: 99999 }) });
  assert.equal(res.statusCode, 400, JSON.stringify(res.body));
  assert.equal(res.body.code, 'CLIENT_REQUIRED');
  assert.equal(count("SELECT COUNT(*) AS n FROM reservations WHERE kind = 'devis'"), before);
});

test('rule 26: a devis updated to a client that does not exist → 400 CLIENT_REQUIRED, the devis unchanged', () => {
  const created = call(devisController.create, { body: f.stayBody() });
  assert.equal(created.statusCode, 201, JSON.stringify(created.body));
  const id = created.body.id;
  const stored = f.db.prepare('SELECT clientId, updatedAt FROM reservations WHERE id = ?').get(id);
  const res = call(devisController.update, { params: { id: String(id) }, body: f.stayBody({ clientId: 99999, notes: 'changé' }) });
  assert.equal(res.statusCode, 400, JSON.stringify(res.body));
  assert.equal(res.body.code, 'CLIENT_REQUIRED');
  assert.deepEqual(f.db.prepare('SELECT clientId, updatedAt FROM reservations WHERE id = ?').get(id), stored);
});

test('rule 26: calculate-price on a logement that does not exist → 404, no option linked to it', async () => {
  const res = await call(f.controller.calculatePrice, { body: f.stayBody({ propertyId: 99999 }) });
  assert.equal(res.statusCode, 404, JSON.stringify(res.body));
  assert.equal(res.body.error, 'Logement non trouvé');
  assert.equal(count('SELECT COUNT(*) AS n FROM property_options WHERE propertyId = 99999'), 0);
});

test('rule 26: a calendar note on a logement that does not exist, or a textual id → 404, nothing written', () => {
  for (const propertyId of ['99999', 'abc']) {
    const res = call(calendarNotesController.upsert, { params: { propertyId, date: todayIso() }, body: { note: 'x' } });
    assert.equal(res.statusCode, 404, `${propertyId}: ${JSON.stringify(res.body)}`);
  }
  assert.equal(count('SELECT COUNT(*) AS n FROM calendar_notes'), 0);
  const ok = call(calendarNotesController.upsert, { params: { propertyId: '1', date: todayIso() }, body: { note: 'x' } });
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
});
