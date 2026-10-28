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
  assert.ok(preview.touristTaxChanged >= 1, `stays re-priced: ${preview.touristTaxChanged}`);
  assert.equal(call(controller.makeSwitch, { ...CORRECTION, fingerprint: preview.fingerprint, acknowledged: true }).statusCode, 201);
  const after = snapshot();
  const changed = diff(before, after);
  for (const [id, columns] of Object.entries(changed)) {
    assert.deepEqual(columns.filter((c) => !ALLOWED.has(c)), [], `stay ${id}: only the allowlist moved`);
  }
  assert.ok(changed[110].includes('touristTaxTotal'));
  assert.deepEqual(changed[106].filter((c) => c !== 'vatPeriodId'), [], 'a stay with an installment plan is not re-priced (rule 27)');
  assert.deepEqual(after.children, before.children, 'child rows, custom options included, are byte for byte');
  assert.equal(after.reservations[110].icalSyncLocked, 0, 'an iCal stay is not locked by the switch');
  assert.equal(after.reservations[110].balanceDueDate, '2027-11-10', 'a stored due date is not rewritten');
  assert.equal(after.reservations[110].tariffSnapshot, before.reservations[110].tariffSnapshot);
});

test('rule 27: the stored tax moves by exactly what the preview announced, and what the engine moved', () => {
  const before = snapshot();
  const quotesBefore = Object.fromEntries([110].map((id) => [id, quote(id).touristTaxTotal]));
  const preview = call(controller.preview, CORRECTION).body;
  call(controller.makeSwitch, { ...CORRECTION, fingerprint: preview.fingerprint, acknowledged: true });
  let delta = 0;
  let changed = 0;
  for (const id of [103, 104, 106, 110]) {
    const moved = Number(row(id).touristTaxTotal) - Number(before.reservations[id].touristTaxTotal);
    if (Math.abs(moved) > 0.004) { changed += 1; delta += moved; }
  }
  for (const id of [110]) {
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
  const current = quote(110);
  assert.equal(planReprice(db, row(110), { ...current, finalPrice: current.finalPrice + 5 }).ok, false);
  assert.equal(planReprice(db, row(110), { ...current, balanceDueDate: '2020-01-01' }).ok, false);
  assert.equal(planReprice(db, row(110), null).ok, false);
  assert.equal(planReprice(db, row(110), current).ok, true);
  assert.deepEqual([planReprice(db, row(106), quote(106)).ok, planReprice(db, row(106), quote(106)).reason], [false, 'plan'], 'a plan stay');
});

test('rules 27 and 33: the retroactive rate edit re-prices the stays of its period with the same write, and reports the skipped', async () => {
  const put = async (vat) => { const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } }; await settingsController.updateSettings({ body: { vat }, user: { id: 1 } }, res); return res; };
  const before = snapshot();
  const res = await put({ rate: 25 });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.vatNotRepriced, [106], 'the installment stay is reported');
  assert.equal(vatRegimeModel.rateForRow(db, { id: 110 }), 25);
  const after = snapshot();
  for (const [id, columns] of Object.entries(diff(before, after))) assert.deepEqual(columns.filter((c) => !ALLOWED.has(c)), [], `stay ${id}`);
  assert.ok(Number(row(110).touristTaxTotal) < Number(before.reservations[110].touristTaxTotal), 'the proportional tax follows the rate');
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

test('rule 34: a link on the converted devis that matched its bucket is retired with the re-price, one already out of date is left alone', () => {
  const balance = Number(row(110).balanceAmount);
  const link = db.prepare("INSERT INTO payment_links (reservationId, type, amountCents, status) VALUES (?, 'balance', ?, 'open')");
  const matching = Number(link.run(devisId, Math.round(balance * 100)).lastInsertRowid);
  const alreadyStale = Number(link.run(devisId, 12345).lastInsertRowid);
  const preview = call(controller.preview, CORRECTION).body;
  const open = () => db.prepare("SELECT COUNT(*) AS n FROM payment_links WHERE status = 'open'").get().n;
  const openBefore = open();
  call(controller.makeSwitch, { ...CORRECTION, fingerprint: preview.fingerprint, acknowledged: true });
  assert.equal(openBefore - open(), preview.linksReplaced, 'exactly the links the preview counted');
  assert.equal(db.prepare('SELECT status FROM payment_links WHERE id = ?').get(matching).status, 'cancelled');
  assert.equal(db.prepare('SELECT status FROM payment_links WHERE id = ?').get(alreadyStale).status, 'open', 'a link that already disagreed is left alone, as the fiche save does');
});

test('rule 34: the guest pays the retired link of a converted devis: it is booked on the reservation it became', () => {
  const { bookPaidAfterAmountChange } = require('../utils/ledgerLinks');
  const balance = Number(row(110).balanceAmount);
  const id = Number(db.prepare("INSERT INTO payment_links (reservationId, type, amountCents, status, cancelReason) VALUES (?, 'balance', ?, 'cancelled', 'amount-changed')").run(devisId, Math.round(balance * 100)).lastInsertRowid);
  const link = db.prepare('SELECT * FROM payment_links WHERE id = ?').get(id);
  const booked = [];
  const result = bookPaidAfterAmountChange({ database: db, recordPayment: (x) => booked.push(x) }, link, { paidDay: '2027-10-21' });
  assert.notEqual(result.effect, 'not-a-reservation');
  assert.deepEqual(booked.map((b) => [b.reservationId, b.bucket]), [[110, 'balance']]);
});

test('rule 27: a stay with an installment plan is not re-priced: reported with its reason, nothing written', () => {
  const stored = row(106);
  const preview = call(controller.preview, CORRECTION).body;
  assert.ok(preview.planStays >= 1);
  assert.ok(preview.lines.some((l) => /séjours? avec échéancier : à recalculer depuis la fiche\./.test(l)));
  const made = call(controller.makeSwitch, { ...CORRECTION, fingerprint: preview.fingerprint, acknowledged: true });
  assert.ok(made.body.notRepriced.includes(106));
  assert.equal(row(106).touristTaxTotal, stored.touristTaxTotal);
  assert.equal(row(106).balanceAmount, stored.balanceAmount);
  assert.equal(row(106).complementAmount, stored.complementAmount);
});

test('rule 26: undo is refused (409, with the stays) once a re-priced stay was paid or declared since', () => {
  const made = call(controller.makeSwitch, { ...FUTURE, fingerprint: call(controller.preview, FUTURE).body.fingerprint, acknowledged: true });
  const before = JSON.stringify(row(110));
  db.prepare("UPDATE reservations SET balancePaid = 1, balancePaidDate = '2027-10-21' WHERE id = 110").run();
  const refused = call(controller.remove, null, { id: made.body.period.id });
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.body.error, 'stay_settled');
  assert.deepEqual(refused.body.stays, ['GF-2027-110']);
  assert.match(refused.body.message, /GF-2027-110/);
  assert.equal(vatRegimeModel.listPeriods(db).length, 2, 'nothing was undone');
  assert.notEqual(JSON.stringify(row(110)), before);
  db.prepare("UPDATE reservations SET balancePaid = 0, balancePaidDate = NULL, touristTaxDeclaredAt = '2027-10-22 10:00:00' WHERE id = 110").run();
  assert.equal(call(controller.remove, null, { id: made.body.period.id }).statusCode, 409, 'a declared tax too');
  db.prepare('UPDATE reservations SET touristTaxDeclaredAt = NULL WHERE id = 110').run();
  assert.equal(call(controller.remove, null, { id: made.body.period.id }).statusCode, 200, 'and again possible once nothing is settled');
});

test('rule 26: a stay born under the unstarted period is re-priced back by the same targeted write', () => {
  const made = call(controller.makeSwitch, { ...FUTURE, fingerprint: call(controller.preview, FUTURE).body.fingerprint, acknowledged: true });
  db.prepare(`INSERT INTO reservations (id, kind, clientId, propertyId, startDate, endDate, adults, children, babies, doubleBeds, singleBeds, platform,
      createdAt, finalPrice, reservationNumber, checkInTime, checkOutTime)
    VALUES (111, 'reservation', 1, 2, '2027-12-20', '2027-12-24', 2, 0, 0, 1, 0, 'direct', '2027-10-20 10:00:00', 1, 'GF-2027-111', '16:00', '10:00')`).run();
  assert.equal(row(111).vatPeriodId, made.body.period.id, 'born under the period by the trigger');
  const q = quote(111);
  db.prepare('UPDATE reservations SET totalPrice = ?, finalPrice = ?, depositAmount = ?, balanceAmount = ?, touristTaxRate = ?, touristTaxTotal = ? WHERE id = 111')
    .run(q.totalPrice, q.finalPrice, q.depositAmount, q.balanceAmount, q.touristTaxRate, q.touristTaxTotal);
  const born = snapshot().reservations[111];
  assert.equal(call(controller.remove, null, { id: made.body.period.id }).statusCode, 200);
  assert.equal(row(111).vatPeriodId, 1);
  const moved = Object.keys(row(111)).filter((c) => JSON.stringify(row(111)[c]) !== JSON.stringify(born[c]));
  assert.deepEqual(moved.filter((c) => !ALLOWED.has(c)), []);
  assert.ok(moved.includes('touristTaxTotal'), 'the tax of a stay born without VAT goes back to the VAT regime\'s');
  assert.equal(row(111).touristTaxTotal, quote(111).touristTaxTotal);
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
  assert.equal(call(controller.remove, null, { id: made.body.period.id }).statusCode, 200);
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

test('rule 26: a balance paid BEFORE the switch, on a tax that rides the complement, does not block the undo', () => {
  db.prepare("UPDATE reservations SET touristTaxInComplement = 1, balancePaid = 1, balancePaidDate = '2027-10-01' WHERE id = 110").run();
  const made = call(controller.makeSwitch, { ...FUTURE, fingerprint: call(controller.preview, FUTURE).body.fingerprint, acknowledged: true });
  const stored = JSON.parse(db.prepare('SELECT repriced FROM vat_periods WHERE id = ?').get(made.body.period.id).repriced || '{}');
  if (stored[110]) assert.ok(!('balanceAmount' in stored[110].after), 'the balance was not the re-priced bucket');
  assert.equal(call(controller.remove, null, { id: made.body.period.id }).statusCode, 200, 'no false refusal');
  db.prepare('UPDATE reservations SET touristTaxInComplement = 0, balancePaid = 0, balancePaidDate = NULL WHERE id = 110').run();
});

test('rule 26: the undo answers 200 with the born stays it left alone — a frozen one included', () => {
  const made = call(controller.makeSwitch, { ...FUTURE, fingerprint: call(controller.preview, FUTURE).body.fingerprint, acknowledged: true });
  db.prepare(`INSERT INTO reservations (id, kind, clientId, propertyId, startDate, endDate, adults, children, babies, doubleBeds, singleBeds, platform,
      createdAt, finalPrice, reservationNumber, checkInTime, checkOutTime, touristTaxDeclaredAt)
    VALUES (112, 'reservation', 1, 2, '2027-12-20', '2027-12-24', 2, 0, 0, 1, 0, 'direct', '2027-10-20 10:00:00', 1, 'GF-2027-112', '16:00', '10:00', '2027-12-25 10:00:00')`).run();
  const res = call(controller.remove, null, { id: made.body.period.id });
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.notRepriced.includes(112), 'a declared (frozen) born stay is reported');
  assert.equal(row(112).vatPeriodId, 1);
});
