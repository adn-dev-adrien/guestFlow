// specs/vat-optional-mode.md rules 27 and 32 — a regime re-prices the stays whose proportional tourist
// tax it moves with a TARGETED write: the engine's figures under the old and the new period are compared,
// the stay is accepted only when every non-tax figure is unchanged, and only an allowlist of columns is
// written (the tax and the amounts it rides on, updatedAt, the period, a history line). Every other column
// and every child row stays byte for byte; the preview announces exactly what is written; the open links
// whose amount no longer matches are retired.

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildVatGoldenDb } = require('./vatRegimeGoldenFixture');

const db = buildVatGoldenDb();
const controller = require('../controllers/vatRegimeController');
const vatRegimeModel = require('../models/vatRegimeModel');
const switchModel = require('../models/vatRegimeSwitchModel');
const settingsController = require('../controllers/settingsController');
const { calculateReservationQuote } = require('../utils/pricing');
const { buildReservationEngineInput } = require('../utils/reservationEngineInput');

const row = (id) => db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
const quote = (id) => calculateReservationQuote(buildReservationEngineInput(db, row(id)));

// Free of any payment: 104 and 103 (platforms), 106 (direct, installment plan). 110 is a direct stay of
// L'Estiva arriving in December (so a change dated ahead moves it), with a stored due date, an iCal origin,
// a custom option and a converted devis.
db.prepare("UPDATE reservations SET balancePaid = 0, balancePaidDate = NULL, touristTaxDeclaredAt = NULL, touristTaxFrozenAt = NULL WHERE id IN (103, 104, 106)").run();
db.prepare('UPDATE reservations SET complementPaid = 0, complementPaidDate = NULL WHERE id = 103').run();
db.prepare('UPDATE reservations SET depositPaid = 0, depositPaidDate = NULL WHERE id = 104').run();
db.prepare(`INSERT INTO reservations (id, kind, clientId, propertyId, startDate, endDate, adults, children, babies, doubleBeds, singleBeds, platform,
    createdAt, finalPrice, reservationNumber, checkInTime, checkOutTime, sourceType, icalSyncLocked, depositDueDate, balanceDueDate)
  VALUES (110, 'reservation', 1, 2, '2027-12-10', '2027-12-15', 2, 0, 0, 1, 0, 'direct', '2027-03-02 10:00:00', 1, 'GF-2027-110', '16:00', '10:00', 'ical', 0, '2027-03-09', '2027-11-10')`).run();
{
  const q = quote(110);
  db.prepare(`UPDATE reservations SET totalPrice = ?, finalPrice = ?, depositAmount = ?, balanceAmount = ?, touristTaxRate = ?, touristTaxTotal = ? WHERE id = 110`)
    .run(q.totalPrice, q.finalPrice, q.depositAmount, q.balanceAmount, q.touristTaxRate, q.touristTaxTotal);
  db.prepare("INSERT INTO reservation_custom_options (reservationId, description, amount, sortOrder) VALUES (110, 'Bois de chauffage', 40, 0)").run();
}
const devisId = Number(db.prepare("INSERT INTO reservations (kind, clientId, propertyId, startDate, endDate, devisStatus, convertedReservationId, validUntil) VALUES ('devis', 1, 2, '2027-12-10', '2027-12-15', 'converted', 110, '2027-12-31')").run().lastInsertRowid);

const call = (fn, body, params) => {
  const res = { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } };
  fn({ body, params, user: { id: 1 } }, res);
  return res;
};
const CHILDREN = ['reservation_options', 'reservation_resources', 'reservation_custom_options', 'reservation_nights', 'reservation_installments', 'reservation_refunds'];  // the refund lines' VAT rate is re-rated on purpose (rule 16)
const snapshot = () => ({
  reservations: Object.fromEntries(db.prepare('SELECT * FROM reservations').all().map((r) => [r.id, r])),
  children: Object.fromEntries(CHILDREN.map((t) => [t, JSON.stringify(db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all())])),
});
const diff = (a, b) => Object.fromEntries(Object.keys(b.reservations).map((id) => [id, Object.keys(b.reservations[id]).filter((c) => JSON.stringify(a.reservations[id][c]) !== JSON.stringify(b.reservations[id][c]))]).filter(([, cols]) => cols.length));
const ALLOWED = new Set([...switchModel.__test.ALLOWLIST, 'updatedAt', 'vatPeriodId']);
const reset = () => {
  db.prepare('UPDATE reservations SET vatPeriodId = 1').run();
  db.prepare('DELETE FROM vat_periods WHERE id > 1').run();
  db.prepare('UPDATE vat_periods SET rate = 10 WHERE id = 1').run();
  vatRegimeModel.syncMirror(db);
};
test.beforeEach(reset);

const CORRECTION = { regime: 'not_subject', basis: 'all' };
const FUTURE = { regime: 'not_subject', basis: 'arrival', effectiveFrom: '2027-11-15' };

test('rule 27: a switch writes only the allowlisted columns and leaves every child row byte for byte', () => {
  const before = snapshot();
  const preview = call(controller.preview, CORRECTION).body;
  assert.ok(preview.touristTaxChanged >= 2, `stays re-priced: ${preview.touristTaxChanged}`);
  assert.equal(call(controller.makeSwitch, { ...CORRECTION, fingerprint: preview.fingerprint, acknowledged: true }).statusCode, 201);
  const after = snapshot();
  const changed = diff(before, after);
  for (const [id, columns] of Object.entries(changed)) {
    assert.deepEqual(columns.filter((c) => !ALLOWED.has(c)), [], `stay ${id}: only the allowlist moved`);
  }
  assert.ok(changed[106].includes('touristTaxTotal') && changed[110].includes('touristTaxTotal'));
  assert.deepEqual(after.children, before.children, 'child rows, custom options included, are byte for byte');
  assert.equal(after.reservations[110].icalSyncLocked, 0, 'an iCal stay is not locked by the switch');
  assert.equal(after.reservations[110].balanceDueDate, '2027-11-10', 'a stored due date is not rewritten');
  assert.equal(after.reservations[110].tariffSnapshot, before.reservations[110].tariffSnapshot);
});

test('rule 27: the stored tax moves by exactly what the preview announced, and what the engine moved', () => {
  const before = snapshot();
  const quotesBefore = Object.fromEntries([106, 110].map((id) => [id, quote(id).touristTaxTotal]));
  const preview = call(controller.preview, CORRECTION).body;
  call(controller.makeSwitch, { ...CORRECTION, fingerprint: preview.fingerprint, acknowledged: true });
  let delta = 0;
  let changed = 0;
  for (const id of [103, 104, 106, 110]) {
    const moved = Number(row(id).touristTaxTotal) - Number(before.reservations[id].touristTaxTotal);
    if (Math.abs(moved) > 0.004) { changed += 1; delta += moved; }
  }
  for (const id of [106, 110]) {
    assert.equal(Math.round((Number(row(id).touristTaxTotal) - Number(before.reservations[id].touristTaxTotal)) * 100), Math.round((quote(id).touristTaxTotal - quotesBefore[id]) * 100));
  }
  assert.equal(changed, preview.touristTaxChanged, 'the same stays');
  assert.ok(Math.abs(delta - preview.touristTaxDelta) < 0.005, `${delta} vs ${preview.touristTaxDelta}`);
});

test('rule 27: the stay\'s history records the tax change and the regime', () => {
  const preview = call(controller.preview, CORRECTION).body;
  call(controller.makeSwitch, { ...CORRECTION, fingerprint: preview.fingerprint, acknowledged: true });
  const lines = db.prepare('SELECT changedFields FROM reservation_history WHERE reservationId = 110 ORDER BY id').all().map((r) => r.changedFields);
  assert.ok(lines.some((l) => l.includes('vatRegime')));
  assert.ok(lines.some((l) => l.includes('"touristTaxTotal"') && l.includes('Taxe de séjour')));
});

test('rule 27: a frozen or declared tax is never touched', () => {
  db.prepare("UPDATE reservations SET touristTaxDeclaredAt = '2027-07-04 09:00:00' WHERE id = 106").run();
  const stored = row(106);
  const preview = call(controller.preview, CORRECTION).body;
  assert.ok(preview.touristTaxKept >= 1);
  call(controller.makeSwitch, { ...CORRECTION, fingerprint: preview.fingerprint, acknowledged: true });
  assert.equal(row(106).touristTaxTotal, stored.touristTaxTotal);
  assert.equal(row(106).balanceAmount, stored.balanceAmount);
  db.prepare('UPDATE reservations SET touristTaxDeclaredAt = NULL WHERE id = 106').run();
});

test('rule 27: a stay whose non-tax figures move between the two periods keeps its stored figures', () => {
  const { planReprice } = switchModel.__test;
  const current = quote(106);
  assert.equal(planReprice(db, row(106), { ...current, finalPrice: current.finalPrice + 5 }).ok, false);
  assert.equal(planReprice(db, row(106), { ...current, balanceDueDate: '2020-01-01' }).ok, false);
  assert.equal(planReprice(db, row(106), null).ok, false);
  assert.equal(planReprice(db, row(106), current).ok, true);
});

test('rules 27 and 33: the retroactive rate edit re-prices the stays of its period with the same write, and reports the skipped', async () => {
  const put = async (vat) => { const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } }; await settingsController.updateSettings({ body: { vat }, user: { id: 1 } }, res); return res; };
  const before = snapshot();
  const res = await put({ rate: 25 });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.vatNotRepriced, []);
  assert.equal(vatRegimeModel.rateForRow(db, { id: 106 }), 25);
  const after = snapshot();
  for (const [id, columns] of Object.entries(diff(before, after))) assert.deepEqual(columns.filter((c) => !ALLOWED.has(c)), [], `stay ${id}`);
  assert.ok(Number(row(106).touristTaxTotal) < Number(before.reservations[106].touristTaxTotal), 'the proportional tax follows the rate');
  assert.deepEqual(after.children, before.children);
});

test('rule 32: the open balance link of a re-priced stay is retired, a deposit link whose amount does not move stays open', () => {
  db.prepare('UPDATE reservations SET depositAmount = 100, balanceAmount = 535.01 WHERE id = 110').run();
  const insertLink = db.prepare("INSERT INTO payment_links (reservationId, type, amountCents, status, providerLinkId) VALUES (?, ?, ?, 'open', ?)");
  const balance = Number(insertLink.run(110, 'balance', 53501, 'pl-balance').lastInsertRowid);
  const deposit = Number(insertLink.run(110, 'deposit', 10000, 'pl-deposit').lastInsertRowid);
  const preview = call(controller.preview, CORRECTION).body;
  assert.ok(preview.linksReplaced >= 1);
  assert.ok(preview.lines.some((l) => l.includes('Envoyer un nouveau lien depuis la fiche')));
  call(controller.makeSwitch, { ...CORRECTION, fingerprint: preview.fingerprint, acknowledged: true });
  const status = (id) => db.prepare('SELECT status, cancelReason, remoteCancelPendingAt FROM payment_links WHERE id = ?').get(id);
  assert.deepEqual([status(balance).status, status(balance).cancelReason], ['cancelled', 'amount-changed']);
  assert.ok(status(balance).remoteCancelPendingAt, 'the provider is owed a deactivation, retried by the poll');
  assert.equal(status(deposit).status, 'open');
});

test('rule 32: a link on the converted devis of a re-priced stay is retired too, and the count is the dry run of the same function', () => {
  db.prepare("INSERT INTO payment_links (reservationId, type, amountCents, status) VALUES (?, 'balance', 12345, 'open')").run(devisId);
  const preview = call(controller.preview, CORRECTION).body;
  const open = () => db.prepare("SELECT COUNT(*) AS n FROM payment_links WHERE status = 'open'").get().n;
  const openBefore = open();
  call(controller.makeSwitch, { ...CORRECTION, fingerprint: preview.fingerprint, acknowledged: true });
  assert.equal(openBefore - open(), preview.linksReplaced, 'exactly the links the preview counted');
  assert.equal(db.prepare('SELECT status FROM payment_links WHERE reservationId = ?').get(devisId).status, 'cancelled');
});

test('rule 32: nothing is told to a provider inside the transaction', () => {
  const source = require('fs').readFileSync(require.resolve('../models/vatRegimeSwitchModel'), 'utf8');
  assert.match(source, /setImmediate\(\(\) => \{/);
  assert.ok(!/await /.test(source), 'the model is synchronous: the deactivation is scheduled after the commit');
});

test('rule 26: undoing a change that has not started restores exactly what it re-priced, and touches a skipped stay not at all', () => {
  const before = snapshot();
  const made = call(controller.makeSwitch, { ...FUTURE, fingerprint: call(controller.preview, FUTURE).body.fingerprint, acknowledged: true });
  assert.equal(made.statusCode, 201);
  const during = snapshot();
  assert.ok(diff(before, during)[110].includes('touristTaxTotal'));
  // A stay the switch skipped keeps whatever it holds, undo or not.
  const skippedAfterSwitch = JSON.stringify(row(105));
  assert.equal(call(controller.remove, null, { id: made.body.period.id }).statusCode, 204);
  const after = snapshot();
  const moved = diff(before, after);
  for (const [id, columns] of Object.entries(moved)) assert.deepEqual(columns.filter((c) => c !== 'updatedAt'), [], `stay ${id} is identical to before the switch, but updatedAt`);
  assert.deepEqual(after.children, before.children);
  assert.equal(JSON.stringify(row(105)), skippedAfterSwitch.replace(/"vatPeriodId":\d+/, `"vatPeriodId":${row(105).vatPeriodId}`));
  const history = db.prepare("SELECT COUNT(*) AS n FROM reservation_history WHERE reservationId = 110").get().n;
  assert.ok(history >= 3, 'the history keeps the switch, the re-price and the undo');
});

test('rule 26: a stay edited after the switch keeps its edit; only the switch\'s own shift is taken back', () => {
  const beforeSwitch = Number(row(110).touristTaxTotal);
  const made = call(controller.makeSwitch, { ...FUTURE, fingerprint: call(controller.preview, FUTURE).body.fingerprint, acknowledged: true });
  assert.notEqual(Number(row(110).touristTaxTotal), beforeSwitch);
  db.prepare('UPDATE reservations SET touristTaxTotal = touristTaxTotal + 1 WHERE id = 110').run();
  call(controller.remove, null, { id: made.body.period.id });
  assert.equal(Math.round(Number(row(110).touristTaxTotal) * 100), Math.round((beforeSwitch + 1) * 100));
});
