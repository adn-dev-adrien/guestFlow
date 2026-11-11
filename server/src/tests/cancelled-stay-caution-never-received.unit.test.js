// specs/reservation-payment-ledger.md rule 74 (audit R43-RES-L1) — a cancelled stay whose caution was never received read
// « Caution reçue 500,00 € · À recevoir à l'arrivée » and « Caution restituée · Après réception », right above the
// closing « Rien à percevoir »: a cancelled stay has no arrival, so that caution will never be taken. It now reads one
// « Caution · Sans objet » row, muted, with no action. A caution received (or returned) keeps its rows (rule 59).
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./reservationSaveFixture');
const { buildLedger } = require('../utils/reservationLedger');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

const TODAY = todayIso();

test.before(() => f.seed());

const cancel = (id) => f.db.prepare("UPDATE reservations SET kind = 'cancelled', cancelledAt = datetime('now') WHERE id = ?").run(id);
const cautionRows = (id) => buildLedger({ row: f.rowOf(id), cautionAmount: 500, today: TODAY }).rows
  .filter((row) => row.key.startsWith('caution'));

test('rule 74: a cancelled stay whose caution was never received reads « Sans objet », muted, no action', () => {
  const id = f.createStay();
  cancel(id);
  const rows = cautionRows(id);
  assert.deepEqual(rows.map((row) => [row.key, row.stateLabel, row.tone, row.action]), [['caution', 'Sans objet', 'muted', null]]);
  assert.equal(rows[0].amount, null, 'no sum announced as due');
});

test('rule 74: the live stay keeps « À recevoir à l\'arrivée »', () => {
  const id = f.createStay();
  const received = cautionRows(id).find((row) => row.key === 'cautionReceived');
  assert.equal(received.stateLabel, 'À recevoir à l\'arrivée');
  cancel(id);
});

test('rule 74: a caution received before the cancellation keeps its rows and « Restituer » (rule 59)', () => {
  const id = f.createStay();
  const res = f.respond();
  f.controller.updatePayment({
    user: f.ADMIN, params: { id: String(id) }, query: {}, body: { cautionReceived: true, cautionReceivedDate: addDaysToIsoDate(TODAY, -1) },
  }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  cancel(id);
  const rows = cautionRows(id);
  assert.deepEqual(rows.map((row) => row.key), ['cautionReceived', 'cautionReturned']);
  assert.equal(rows[1].stateLabel, 'À rendre');
});
