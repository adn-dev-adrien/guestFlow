// specs/vat-optional-mode.md rule 27 — the stays whose proportional tourist tax a regime moves are
// re-saved through the fiche's own save inside the switch (and by the retroactive rate edit), so the
// stored tax and totals equal what the preview announced, and what a payment link would charge. A frozen
// or declared tax never moves.

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildVatGoldenDb } = require('./vatRegimeGoldenFixture');

const db = buildVatGoldenDb();
const controller = require('../controllers/vatRegimeController');
const vatRegimeModel = require('../models/vatRegimeModel');
const { calculateReservationQuote } = require('../utils/pricing');
const { buildReservationEngineInput } = require('../utils/reservationEngineInput');
const settingsController = require('../controllers/settingsController');

// Two stays of L'Estiva (proportional tax) free of any payment: 104 (booking platform) and 106 (direct).
db.prepare("UPDATE reservations SET balancePaid = 0, balancePaidDate = NULL, touristTaxDeclaredAt = NULL, touristTaxFrozenAt = NULL WHERE id IN (103, 104, 106)").run();
db.prepare('UPDATE reservations SET complementPaid = 0, complementPaidDate = NULL WHERE id = 103').run();
db.prepare('UPDATE reservations SET depositPaid = 0, depositPaidDate = NULL WHERE id = 104').run();

const call = (fn, body) => {
  const res = { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } };
  fn({ body, user: { id: 1 } }, res);
  return res;
};
const row = (id) => db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
const quote = (id) => calculateReservationQuote(buildReservationEngineInput(db, row(id)));
const STAYS = [103, 104, 106];

test('rule 27: after the switch the stored tax of every movable stay is the engine\'s, and the preview said so', () => {
  const before = Object.fromEntries(STAYS.map((id) => [id, row(id).touristTaxTotal]));
  const input = { regime: 'not_subject', basis: 'all' };
  const preview = call(controller.preview, input).body;
  assert.ok(preview.touristTaxChanged >= 1, `stays re-priced: ${preview.touristTaxChanged}`);
  const made = call(controller.makeSwitch, { ...input, fingerprint: preview.fingerprint, acknowledged: true });
  assert.equal(made.statusCode, 201);
  assert.deepEqual(made.body.notRepriced, []);

  let delta = 0;
  let changed = 0;
  for (const id of STAYS) {
    const stored = row(id);
    const live = quote(id);
    assert.equal(Number(stored.touristTaxTotal), live.touristTaxTotal, `stay ${id}: stored tax = engine tax`);
    assert.equal(Number(stored.finalPrice), live.finalPrice, `stay ${id}: the price did not move`);
    if (Math.abs(Number(stored.touristTaxTotal) - Number(before[id])) > 0.004) { changed += 1; delta += Number(stored.touristTaxTotal) - Number(before[id]); }
  }
  assert.equal(changed, preview.touristTaxChanged, 'the same stays');
  assert.ok(Math.abs(delta - preview.touristTaxDelta) < 0.005, `${delta} vs ${preview.touristTaxDelta}`);
});

test('rule 27: the tourist tax a payment link would put on its basket is the re-priced one', () => {
  const { storedReservationComponents } = require('../controllers/paymentsController').__test;
  db.prepare('UPDATE reservations SET touristTaxFrozenAt = NULL, balanceAmount = 500 WHERE id = 106').run();
  const basket = storedReservationComponents(106, 'balance');
  const tax = basket.components.find((c) => c.title === 'Taxe de séjour');
  assert.equal(tax.grossCents, Math.round(Number(row(106).touristTaxTotal) * 100));
});

test('rule 27: the stay\'s history records the re-save, and the regime line', () => {
  const kinds = db.prepare("SELECT changedFields FROM reservation_history WHERE reservationId = 106 ORDER BY id").all().map((r) => r.changedFields);
  assert.ok(kinds.some((k) => k.includes('vatRegime')));
  assert.ok(kinds.some((k) => k.toLowerCase().includes('taxe')), 'the tourist-tax change is journaled by the save itself');
});

test('rule 27: a frozen or declared tax is never re-saved', () => {
  db.prepare("UPDATE reservations SET touristTaxDeclaredAt = '2027-07-04 09:00:00' WHERE id = 106").run();
  const stored = row(106).touristTaxTotal;
  const input = { regime: 'subject', rate: 10, basis: 'all' };
  const preview = call(controller.preview, input).body;
  assert.ok(preview.touristTaxKept >= 1);
  call(controller.makeSwitch, { ...input, fingerprint: preview.fingerprint, acknowledged: true });
  assert.equal(row(106).touristTaxTotal, stored);
  db.prepare('UPDATE reservations SET touristTaxDeclaredAt = NULL WHERE id = 106').run();
});

test('rule 27: the retroactive rate edit (rule 9) re-saves the stays of its period the same way', async () => {
  const put = async (vat) => { const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } }; await settingsController.updateSettings({ body: { vat }, user: { id: 1 } }, res); return res; };
  call(controller.makeSwitch, { regime: 'subject', rate: 10, basis: 'all', fingerprint: call(controller.preview, { regime: 'subject', rate: 10, basis: 'all' }).body.fingerprint, acknowledged: true });
  const before = Number(row(106).touristTaxTotal);
  assert.equal((await put({ rate: 25 })).statusCode, 200);
  assert.equal(vatRegimeModel.rateForRow(db, { id: 106 }), 25);
  const after = Number(row(106).touristTaxTotal);
  assert.equal(after, quote(106).touristTaxTotal);
  assert.ok(after < before, `the proportional tax follows the rate: ${before} -> ${after}`);
});

test('rule 27: a stay whose save would also move its PRICE keeps its stored figures and is reported', () => {
  db.prepare('UPDATE vat_periods SET rate = 10 WHERE id = 1').run();
  call(controller.makeSwitch, { regime: 'not_subject', basis: 'all', fingerprint: call(controller.preview, { regime: 'not_subject', basis: 'all' }).body.fingerprint, acknowledged: true });
  db.prepare('UPDATE reservations SET finalPrice = finalPrice + 5 WHERE id = 106').run();
  const stored = row(106);
  const input = { regime: 'subject', rate: 10, basis: 'all' };
  const preview = call(controller.preview, input).body;
  assert.ok(preview.notRepriced >= 1);
  assert.ok(preview.lines.some((l) => /garde sa taxe de séjour enregistrée|gardent leur taxe de séjour enregistrée/.test(l)));
  const made = call(controller.makeSwitch, { ...input, fingerprint: preview.fingerprint, acknowledged: true });
  assert.ok(made.body.notRepriced.includes(106));
  assert.equal(row(106).touristTaxTotal, stored.touristTaxTotal);
  assert.equal(row(106).finalPrice, stored.finalPrice);
});
