// specs/reservations-backend-mvc.md rule 26 reading (audit R44-C-L3) — PUT /reservations/:id on a stay that does not
// exist reached the line inserts and failed on their foreign key: a 500 « Enregistrement impossible. ». It is now
// refused first, 404 « Réservation non trouvée », with or without a valid body, nothing written.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./reservationSaveFixture');

const count = (sql, ...args) => f.db.prepare(sql).get(...args).n;

test.before(() => f.seed());

async function put(id, body) {
  const res = f.respond();
  await f.controller.update({ params: { id: String(id) }, body, user: f.ADMIN, query: {} }, res);
  return res;
}

test('rule 26: saving a stay that does not exist → 404, nothing written', async () => {
  const before = count('SELECT COUNT(*) AS n FROM reservation_history');
  for (const body of [f.stayBody(), f.stayBody({ options: [] }), { notes: 'x' }, {}]) {
    const res = await put(999999, body);
    assert.equal(res.statusCode, 404, JSON.stringify(res.body));
    assert.equal(res.body.error, 'Réservation non trouvée');
  }
  assert.equal(count('SELECT COUNT(*) AS n FROM reservations WHERE id = 999999'), 0);
  assert.equal(count('SELECT COUNT(*) AS n FROM reservation_options WHERE reservationId = 999999'), 0);
  assert.equal(count('SELECT COUNT(*) AS n FROM reservation_history'), before);
});

test('rule 26: the same body on a stay that exists still saves', async () => {
  const created = f.create(f.stayBody());
  assert.equal(created.statusCode, 200, JSON.stringify(created.body));
  const res = await put(created.body.id, f.stayBody({ notes: 'changé' }));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
});
