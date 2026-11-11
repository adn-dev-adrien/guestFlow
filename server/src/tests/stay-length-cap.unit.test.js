// specs/reservations-backend-mvc.md rule 11, reading of 2026-11-02 (audit R19-L1) — a stay lasts at most
// 366 nights, the iCal parser's cap. The internal paths priced any length night by night, synchronously:
// a departure typed as 9999-12-31 froze the whole server for ~100 s. Refused fast, 400 INVALID_STAY_DATES,
// field endDate, « Séjour trop long. », before pricing, nothing written.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./reservationSaveFixture');
const devisController = require('../controllers/devisController');
const { MAX_STAY_NIGHTS, stayDatesRefusal } = require('../utils/stayDates');

const TOO_LONG = 'Séjour trop long.';
const FAST_MS = 500;
const FAR_DEPARTURE = '9999-12-31'; // date-literal-ok: the audit's typo, never compared with today

const LONG_RANGES = [
  { name: 'a 9999-12-31 departure', startDate: f.inDays(70), endDate: FAR_DEPARTURE },
  { name: 'a 367-night stay', startDate: f.inDays(70), endDate: f.inDays(70 + 367) },
];

test.before(() => f.seed());

const count = (kind) => f.db.prepare('SELECT COUNT(*) AS n FROM reservations WHERE kind = ?').get(kind).n;

async function timed(run) {
  const started = Date.now();
  const res = await run();
  return { res, ms: Date.now() - started };
}

function call(handler, req) {
  const res = f.respond();
  const out = handler(req, res);
  return out && typeof out.then === 'function' ? out.then(() => res) : res;
}

function assertTooLong({ res, ms }) {
  assert.equal(res.statusCode, 400, JSON.stringify(res.body));
  assert.deepEqual(res.body, { error: TOO_LONG, code: 'INVALID_STAY_DATES', field: 'endDate' });
  assert.ok(ms < FAST_MS, `refused in ${ms} ms`);
}

test('rule 11 (R19-L1): the cap is the iCal parser\'s 366 nights', () => {
  assert.equal(MAX_STAY_NIGHTS, 366);
  assert.equal(stayDatesRefusal(f.inDays(10), f.inDays(10 + 366)), null);
  assert.deepEqual(stayDatesRefusal(f.inDays(10), f.inDays(10 + 367)), { status: 400, error: TOO_LONG, code: 'INVALID_STAY_DATES', field: 'endDate' });
  assert.equal(stayDatesRefusal(f.inDays(10), FAR_DEPARTURE).error, TOO_LONG);
});

LONG_RANGES.forEach(({ name, startDate, endDate }, i) => {
  const at = (n) => f.inDays(n + i * 40);
  test(`rule 11 (R19-L1): calculate-price refuses ${name} fast`, async () => {
    assertTooLong(await timed(() => call(f.controller.calculatePrice, { body: f.stayBody({ startDate, endDate }), user: f.ADMIN })));
  });

  test(`rule 11 (R19-L1): POST /reservations refuses ${name} fast and writes nothing`, async () => {
    const before = count('reservation');
    assertTooLong(await timed(() => f.create(f.stayBody({ startDate, endDate }))));
    assert.equal(count('reservation'), before);
  });

  test(`rule 11 (R19-L1): PUT /reservations/:id refuses ${name} fast and keeps the stored dates`, async () => {
    const id = f.createStay({ startDate: at(500), endDate: at(503) });
    assertTooLong(await timed(() => f.save(id, { startDate, endDate })));
    assert.equal(f.rowOf(id).endDate, at(503));
  });

  test(`rule 11 (R19-L1): POST /devis refuses ${name} fast and writes nothing`, async () => {
    f.seed();
    const before = count('devis');
    assertTooLong(await timed(() => call(devisController.create, { body: f.stayBody({ startDate, endDate }), user: f.ADMIN })));
    assert.equal(count('devis'), before);
  });

  test(`rule 11 (R19-L1): PUT /devis/:id refuses ${name} fast and keeps the stored dates`, async () => {
    f.seed();
    const created = call(devisController.create, { body: f.stayBody({ startDate: at(520), endDate: at(523) }), user: f.ADMIN });
    assert.equal(created.statusCode, 201, JSON.stringify(created.body));
    const id = created.body.id;
    assertTooLong(await timed(() => call(devisController.update, { params: { id: String(id) }, body: f.stayBody({ startDate, endDate }), user: f.ADMIN })));
    assert.equal(f.rowOf(id).endDate, at(523));
  });
});

test('rule 11 (R19-L1): a 366-night stay is still quoted and saved', async () => {
  const startDate = f.inDays(1200);
  const endDate = f.inDays(1200 + 366);
  const quote = await call(f.controller.calculatePrice, { body: f.stayBody({ startDate, endDate }), user: f.ADMIN });
  assert.equal(quote.statusCode, 200, JSON.stringify(quote.body));
  const res = f.create(f.stayBody({ startDate, endDate }));
  assert.ok(res.statusCode === 200 || res.statusCode === 201, JSON.stringify(res.body));
  assert.equal(f.rowOf(res.body.id).endDate, endDate);
});
