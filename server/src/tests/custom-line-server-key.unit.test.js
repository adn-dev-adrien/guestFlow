// specs/pricing-components.md §3 rule 114 (stabilisation loop t8, UI8-5) — a custom line carries the server's own key (`key`, `extraLineKey`)
// on the fiche's live quote (`calculate-price`; the engine's quote itself stays key for key, rule 4) and on the stored summary, so the
// fiche matches `refundedLoweredLines` on it and never rebuilds a key from a label.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row } = require('./saleRound1Fixtures');

const ctrl = require('../controllers/reservationsController');
const { storedBody } = require('../utils/stayOrderLines');
const { quoteStoredReservation } = require('../utils/storedReservationQuote');
const { extraLineKey } = require('../utils/pricing/storedLines');

const respond = () => ({ statusCode: 200, body: null, status(s) { this.statusCode = s; return this; }, json(b) { this.body = b; return this; } });
const call = (handler, params, body) => { const res = respond(); handler({ params, body, query: {}, user: { id: 1, role: 'admin' } }, res); return res; };

function withCustomLine() {
  const id = stay(20);
  const body = storedBody(id);
  const saved = ctrl.performUpdate(id, { ...body, customOptions: [{ customKey: 'custom_1', description: 'Bière  Pression', amount: 30, offered: false }] });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  return id;
}

test('UI8-5 — the fiche\'s live quote serves the custom line\'s key, equal to the key the server reads the line by; the engine quote is unchanged (rule 4)', async () => {
  const id = withCustomLine();
  const engine = quoteStoredReservation(db, row(id)).optionLines.find((l) => l.isCustom);
  assert.equal('key' in engine, false, 'the engine quote stays key for key what it was (pricing-components.md rule 4)');
  const body = storedBody(id);
  const quote = await new Promise((resolve) => {
    ctrl.calculatePrice({
      body: { ...body, reservationId: id, customOptions: [{ customKey: 'custom_1', description: 'Bière  Pression', amount: 30, offered: false }] },
      user: { id: 1, role: 'admin' }, params: {}, query: {},
    }, { status() { return this; }, json: resolve });
  });
  assert.equal(quote.error, undefined, JSON.stringify(quote));
  const custom = quote.optionLines.find((l) => l.isCustom);
  assert.equal(custom.key, 'custom:bière pression');
  assert.equal(custom.key, extraLineKey(custom));
});

test('UI8-5 — the stored summary\'s custom line carries the same key', () => {
  const id = withCustomLine();
  const summary = call(ctrl.getById, { id }, undefined).body.storedSummary;
  const custom = summary.optionLines.find((l) => l.isCustom);
  assert.equal(custom.key, 'custom:bière pression');
});
