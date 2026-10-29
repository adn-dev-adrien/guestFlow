// specs/reservation-save-keeps-pricing.md rules 8-11 — round 2 of the money audit (C, D, E, F): the trop-perçu
// of a stored stay is measured against the STORED price and what was collected, so a confirmed one survives a
// reload (#22306: 2 301,60 paid, then -10 % = 176,30) and engine drift is never one (#14); the live ledger
// reports the change relative to the stored figure; the 409 carries the refund means; the detail line of a
// complement excess does not claim « 0,00 € dus ».

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

let seeded = false;
let slot = 0;
function seed(db) {
  db.prepare(`INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPerDayPerPerson, depositEnabled)
              VALUES (1, 'Gîte', 8, 'per_day_per_person', 1, 0)`).run();
  db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (1, 'Standard', 100)").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Revue')").run();
  seeded = true;
}

async function stay(extra = {}) {
  const db = require('../database');
  const controller = require('../controllers/reservationsController');
  if (!seeded) seed(db);
  slot += 1;
  const day = (offset) => new Date(Date.UTC(2099, 0, 1 + offset)).toISOString().slice(0, 10);
  const body = (overrides = {}) => ({
    propertyId: 1, clientId: 1, startDate: day(slot * 4), endDate: day(slot * 4 + 3), checkInTime: '16:00', checkOutTime: '10:00',
    platform: 'direct', adults: 2, children: 0, teens: 0, babies: 0, singleBeds: 0, doubleBeds: 0, babyBeds: 0, depositDisabled: 1,
    options: [], ...extra, ...overrides,
  });
  const created = await new Promise((resolve) => {
    controller.create({ body: body(), user: { role: 'admin' } }, { status() { return this; }, json: resolve });
  });
  return { db, controller, id: created.id, body };
}

const get = (controller, id) => new Promise((resolve) => {
  controller.getById({ params: { id: String(id) }, user: { role: 'admin', roles: ['admin'] } }, { status() { return this; }, json: resolve });
});
const overpaymentRow = (fiche) => fiche.ledger.rows.find((r) => r.key === 'overpayment');
const preview = (controller, id, body) => new Promise((resolve) => {
  controller.calculatePrice({ body: { ...body, reservationId: id, selectedOptions: [], customOptions: [], selectedResources: [] }, user: { role: 'admin' } }, { status() { return this; }, json: resolve });
});

test('rule 8 — a confirmed trop-perçu survives the reload and shows on a locked fiche (#22306: solde paid, then -10 %)', async () => {
  const { db, controller, id, body } = await stay();
  const total = db.prepare('SELECT finalPrice + touristTaxTotal AS t FROM reservations WHERE id = ?').get(id).t;
  db.prepare('UPDATE reservations SET balancePaid = 1, balanceAmount = finalPrice + touristTaxTotal WHERE id = ?').run(id);
  const refused = controller.performUpdate(id, body({ discountPercent: 10 }));
  assert.equal(refused.status, 409, JSON.stringify(refused.body));
  const forced = controller.performUpdate(id, body({ discountPercent: 10, forceOverpayment: true }));
  assert.equal(forced.status, 200, JSON.stringify(forced.body));
  const after = db.prepare('SELECT finalPrice, touristTaxTotal, balanceAmount FROM reservations WHERE id = ?').get(id);
  const expected = Math.round((total - (after.finalPrice + after.touristTaxTotal)) * 100) / 100;
  assert.ok(expected > 0);
  assert.equal(overpaymentRow(await get(controller, id)).amount, expected, 'after the reload');
  db.prepare("UPDATE reservations SET startDate = '2000-01-10', endDate = '2000-01-13' WHERE id = ?").run(id);
  assert.equal(overpaymentRow(await get(controller, id)).amount, expected, 'on a locked fiche');
});

test('rule 8 — engine drift is not a trop-perçu on the GET: paid in full at the stored price (#14)', async () => {
  const { db, controller, id } = await stay();
  db.prepare('UPDATE reservations SET finalPrice = 330, balancePaid = 1, balanceAmount = 330 + touristTaxTotal WHERE id = ?').run(id);
  assert.equal(overpaymentRow(await get(controller, id)), undefined);
});

test('rule 8 — a platform stay has none, whatever was collected (the platform refunds its guest)', async () => {
  const { db, controller, id } = await stay();
  db.prepare("UPDATE reservations SET platform = 'Airbnb', finalPrice = 100, balancePaid = 1, balanceAmount = 500 WHERE id = ?").run(id);
  assert.equal(overpaymentRow(await get(controller, id)), undefined);
});

test('rule 9 — an unlocked past fiche saved with a note reports no trop-perçu from engine drift (#14)', async () => {
  const { db, controller, id, body } = await stay();
  db.prepare("UPDATE reservations SET finalPrice = finalPrice + 30, balancePaid = 1, balanceAmount = finalPrice + 30 + touristTaxTotal WHERE id = ?").run(id);
  const live = await preview(controller, id, body({ notes: 'Une note' }));
  assert.equal(live.overpaymentTtc, 0);
});

test('rule 9 — an edit on top of a stored trop-perçu adds only its own change', async () => {
  const { db, controller, id, body } = await stay();
  db.prepare('UPDATE reservations SET finalPrice = finalPrice - 20, balancePaid = 1, balanceAmount = (SELECT finalPrice + touristTaxTotal FROM reservations WHERE id = ?) WHERE id = ?').run(id, id);
  const live = await preview(controller, id, body({ notes: 'Une note' }));
  assert.equal(live.overpaymentTtc, 20, 'the stored excess, no more');
});

test('rule 10 — the 409 OVERPAID carries the refund means: caisse interne when the excess sits on a complement taken there', async () => {
  const db = require('../database');
  const controller = require('../controllers/reservationsController');
  const { id, body } = await stay({ touristTaxInComplement: 1 });
  db.prepare("UPDATE reservations SET balancePaid = 1, balanceAmount = finalPrice, complementPaid = 1, complementPaidCash = 1, complementPaidDate = date('now'), complementAmount = 6 WHERE id = ?").run(id);
  const refused = controller.performUpdate(id, body({ adults: 1 }));
  assert.equal(refused.status, 409, JSON.stringify(refused.body));
  assert.equal(refused.body.overpaymentMethod, 'internal');
  db.prepare('UPDATE reservations SET complementPaidCash = 0 WHERE id = ?').run(id);
  assert.equal(controller.performUpdate(id, body({ adults: 1 })).body.overpaymentMethod, null);
});

test('rule 11 — the detail line of a complement excess says what was collected in excess, not « 0,00 € dus »', async () => {
  const { db, controller, id } = await stay({ touristTaxInComplement: 1 });
  db.prepare("UPDATE reservations SET startDate = '2000-02-01', endDate = '2000-02-04', balancePaid = 1, balanceAmount = finalPrice, complementPaid = 1, complementPaidCash = 0, complementPaidDate = date('now'), complementAmount = 40 WHERE id = ?").run(id);
  const row = overpaymentRow(await get(controller, id));
  assert.ok(row);
  assert.ok(row.detail.lines.length > 0);
  for (const line of row.detail.lines) assert.doesNotMatch(line, /dus/);
});

// ── Review of the fix: what the stored measure must also count (rule 12) ─────────────────────────────────────
const price = (db, id) => db.prepare('SELECT finalPrice + touristTaxTotal AS t FROM reservations WHERE id = ?').get(id).t;

test('rule 12 — an installment stay: the paid installments are collected (#22326)', async () => {
  const { db, controller, id } = await stay();
  const total = price(db, id);
  db.prepare('UPDATE reservations SET depositAmount = 0, balanceAmount = 0, finalPrice = finalPrice - 30 WHERE id = ?').run(id);
  const insert = db.prepare("INSERT INTO reservation_installments (reservationId, number, dueDate, amountCents, paid, paidDate) VALUES (?, ?, '2099-01-01', ?, 1, '2099-01-01')");
  const cents = Math.round(total * 100);
  insert.run(id, 1, Math.floor(cents / 3)); insert.run(id, 2, Math.floor(cents / 3)); insert.run(id, 3, cents - 2 * Math.floor(cents / 3));
  assert.equal(overpaymentRow(await get(controller, id)).amount, 30);
});

test('rule 12 — a paid bucket counts at the larger of its captured contribs and its stored amount (a removed paid line, #22303)', async () => {
  const { db, controller, id } = await stay();
  db.prepare('UPDATE reservations SET touristTaxTotal = 0, finalPrice = 250, balancePaid = 1, balanceAmount = 330, accommodationSoldeContribTtc = 250, touristTaxSoldeContribTtc = 0 WHERE id = ?').run(id);
  assert.equal(overpaymentRow(await get(controller, id)).amount, 80);
});

test('rule 12 — what the mid-stay extras collected at check-out is collected (#22281): a real excess is neither hidden nor reduced', async () => {
  const { db, controller, id } = await stay();
  const total = price(db, id);
  const detail = JSON.stringify([{ label: 'Bain nordique', amount: 50, source: 'midStayExtra', key: 'res:2', qty: 1, unitPrice: 50 }]);
  db.prepare('UPDATE reservations SET finalPrice = finalPrice - 20, balancePaid = 1, balanceAmount = ?, endOfStayComplementPaid = 1, endOfStayComplementAmount = 50, endOfStayComplementDetail = ? WHERE id = ?').run(total - 50, detail, id);
  assert.equal(overpaymentRow(await get(controller, id)).amount, 20);
  db.prepare('UPDATE reservations SET finalPrice = finalPrice + 20 WHERE id = ?').run(id);
  assert.equal(overpaymentRow(await get(controller, id)), undefined, 'no false excess when everything was collected');
});

test('rule 12 — an adjusted complement is left out of both sides: no false excess whatever its amount', async () => {
  const { db, controller, id } = await stay({ touristTaxInComplement: 1 });
  db.prepare("UPDATE reservations SET balancePaid = 1, balanceAmount = finalPrice, complementPaid = 1, complementPaidDate = date('now'), complementAmount = 60, complementAmountOverride = 60 WHERE id = ?").run(id);
  assert.equal(overpaymentRow(await get(controller, id)), undefined);
  db.prepare('UPDATE reservations SET complementAmount = 2, complementAmountOverride = 2 WHERE id = ?').run(id);
  assert.equal(overpaymentRow(await get(controller, id)), undefined);
});

test('rule 12 — the refund of a sold line does not eat into the excess; a free « Trop-perçu » refund does (#22306)', async () => {
  const { db, controller, id } = await stay();
  db.prepare('UPDATE reservations SET finalPrice = finalPrice - 30, balancePaid = 1, balanceAmount = finalPrice + touristTaxTotal WHERE id = ?').run(id);
  const refunds = require('../models/refundsModel');
  refunds.create(id, { refundDate: '2099-01-01', method: 'transfer', reason: '', totalTtc: 80, lines: [{ lineKey: 'opt:7', label: 'Ménage', bucket: 'options', quantity: 1, unitPrice: 80, amountTtc: 80, vatRate: 10 }] });
  assert.equal(overpaymentRow(await get(controller, id)).amount, 30);
  refunds.create(id, { refundDate: '2099-01-02', method: 'transfer', reason: '', totalTtc: 10, lines: [{ lineKey: null, label: 'Trop-perçu', bucket: 'accommodation', quantity: null, unitPrice: null, amountTtc: 10, vatRate: 10 }] });
  assert.equal(overpaymentRow(await get(controller, id)).amount, 20);
});

test('rule 13 — the live ledger goes down when the edit absorbs the stored excess', async () => {
  const { db, controller, id, body } = await stay();
  db.prepare('UPDATE reservations SET balancePaid = 1, balanceAmount = finalPrice + touristTaxTotal WHERE id = ?').run(id);
  assert.equal(controller.performUpdate(id, body({ discountPercent: 10, forceOverpayment: true })).status, 200);
  assert.ok(overpaymentRow(await get(controller, id)).amount > 0);
  const live = await preview(controller, id, body({ discountPercent: 0 }));
  assert.equal(live.overpaymentTtc, 0);
});

// ── Re-review of the fix (rules 14-15) ──────────────────────────────────────────────────────────────────
test('rule 14 — the live figure goes down on one refund basis: line refunds and free refunds do not distort the delta (#22306)', async () => {
  const { db, controller, id, body } = await stay();
  db.prepare('UPDATE reservations SET balancePaid = 1, balanceAmount = finalPrice + touristTaxTotal WHERE id = ?').run(id);
  assert.equal(controller.performUpdate(id, body({ discountPercent: 10, forceOverpayment: true })).status, 200);
  const stored = overpaymentRow(await get(controller, id)).amount;
  const refunds = require('../models/refundsModel');
  refunds.create(id, { refundDate: '2099-01-01', method: 'transfer', reason: '', totalTtc: 80, lines: [{ lineKey: 'opt:7', label: 'Ménage', bucket: 'options', quantity: 1, unitPrice: 80, amountTtc: 80, vatRate: 10 }] });
  refunds.create(id, { refundDate: '2099-01-02', method: 'transfer', reason: '', totalTtc: 10, lines: [{ lineKey: null, label: 'Trop-perçu', bucket: 'accommodation', quantity: null, unitPrice: null, amountTtc: 10, vatRate: 10 }] });
  const open = stored - 10;
  assert.equal((await preview(controller, id, body({ discountPercent: 10, notes: 'n' }))).overpaymentTtc, open, 'unchanged price: the stored figure');
  assert.equal((await preview(controller, id, body({ discountPercent: 0 }))).overpaymentTtc, 0, 'fully absorbed');
  const half = (await preview(controller, id, body({ discountPercent: 5 }))).overpaymentTtc;
  assert.ok(half > 0 && half < open, `partly absorbed: ${half}`);
});

test('rule 15 — with no captured split the excess is split by what left since the collection: a removed prestation on the options, a fallen tax on the tax', async () => {
  const { db, controller, id, body } = await stay({ customOptions: [{ customKey: 'a', description: 'Panier', amount: 80, offered: false }] });
  db.prepare('UPDATE reservations SET balancePaid = 1, balanceAmount = finalPrice + touristTaxTotal WHERE id = ?').run(id);
  const refused = controller.performUpdate(id, body({ customOptions: [] }));
  assert.equal(refused.status, 409, JSON.stringify(refused.body));
  assert.deepEqual(refused.body.overpaymentLines.map((l) => [l.bucket, l.amountTtc]), [['options', 80]], 'on the 409');
  assert.equal(controller.performUpdate(id, body({ customOptions: [], forceOverpayment: true })).status, 200);
  const row = overpaymentRow(await get(controller, id));
  assert.deepEqual(row.refundPrefill.overpaymentLines.map((l) => [l.bucket, l.amountTtc]), [['options', 80]], 'after the reload');
  for (const line of row.detail.lines) assert.match(line, /^[^:]+ : [\d\s.,  ]+€ encaissés en trop$/);

  const taxed = await stay();
  taxed.db.prepare('UPDATE reservations SET balancePaid = 1, balanceAmount = finalPrice + touristTaxTotal WHERE id = ?').run(taxed.id);
  assert.equal(taxed.controller.performUpdate(taxed.id, taxed.body({ adults: 1, forceOverpayment: true })).status, 200);
  const taxRow = overpaymentRow(await get(taxed.controller, taxed.id));
  assert.deepEqual(taxRow.refundPrefill.overpaymentLines.map((l) => [l.bucket, l.amountTtc]), [['touristTax', 3]]);
});

// ── Closing the poste notes (rule 15) ────────────────────────────────────────────────────────────────────
const setHistoryDates = (db, id, dates) => {
  const rows = db.prepare('SELECT id FROM reservation_history WHERE reservationId = ? ORDER BY id').all(id);
  rows.forEach((r, i) => db.prepare('UPDATE reservation_history SET createdAt = ? WHERE id = ?').run(dates[i] || dates[dates.length - 1], r.id));
};

test('rule 15 — the window starts at the first money collected (a paid installment): a drop before it is not the excess', async () => {
  const { db, controller, id, body } = await stay({ customOptions: [{ customKey: 'a', description: 'Panier', amount: 80, offered: false }] });
  assert.equal(controller.performUpdate(id, body({ customOptions: [] })).status, 200); // option removed, nothing collected yet
  const total = price(db, id);
  db.prepare('UPDATE reservations SET depositAmount = 0, balanceAmount = 0 WHERE id = ?').run(id);
  const cents = Math.round(total * 100);
  const insert = db.prepare("INSERT INTO reservation_installments (reservationId, number, dueDate, amountCents, paid, paidDate) VALUES (?, ?, '2099-01-01', ?, 1, '2099-01-01')");
  insert.run(id, 1, Math.floor(cents / 2)); insert.run(id, 2, cents - Math.floor(cents / 2));
  assert.equal(controller.performUpdate(id, body({ customOptions: [], discountPercent: 10, forceOverpayment: true })).status, 200); // after the payment
  setHistoryDates(db, id, ['2098-12-01 10:00:00', '2098-12-01 10:00:00', '2099-02-01 10:00:00']);
  const row = overpaymentRow(await get(controller, id));
  assert.deepEqual(row.refundPrefill.overpaymentLines.map((l) => l.bucket), ['accommodation'], 'the 80 € dropped before the first payment is not the excess');
});

test('rule 15 — an option removed then re-added inside the window nets to nothing', async () => {
  const { db, controller, id, body } = await stay({ customOptions: [{ customKey: 'a', description: 'Panier', amount: 80, offered: false }] });
  db.prepare('UPDATE reservations SET balancePaid = 1, balanceAmount = finalPrice + touristTaxTotal WHERE id = ?').run(id);
  assert.equal(controller.performUpdate(id, body({ customOptions: [], forceOverpayment: true })).status, 200);
  assert.equal(controller.performUpdate(id, body({ forceOverpayment: true })).status, 200); // back to the Panier
  const paid = db.prepare('SELECT finalPrice FROM reservations WHERE id = ?').get(id).finalPrice;
  db.prepare('UPDATE reservations SET balanceAmount = balanceAmount + 0 WHERE id = ?').run(id);
  assert.equal(controller.performUpdate(id, body({ discountPercent: 10, forceOverpayment: true })).status, 200);
  const row = overpaymentRow(await get(controller, id));
  assert.ok(row && paid > 0);
  assert.ok(!row.refundPrefill.overpaymentLines.some((l) => l.bucket === 'options'), 'the removed-then-restored line is not an excess');
  assert.equal(row.refundPrefill.overpaymentLines.reduce((t, l) => t + l.amountTtc, 0), row.amount);
});

test('rule 15 — on the GET a line today\'s engine no longer derives is not an options share without an edit', async () => {
  const { db, controller, id } = await stay();
  const option = db.prepare(`INSERT INTO options (title, priceType, price, autoOptionType, autoEnabled, autoPricingMode, autoFullNightThreshold)
    VALUES ('Arrivée test', 'per_stay', 40, 'early_check_in', 1, 'proportional', '10:00')`).run().lastInsertRowid;
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, ?)').run(option);
  // Stored with a 40 € early check-in line that the engine, at the property's default arrival, no longer derives.
  db.prepare("INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice) VALUES (?, ?, 1, 40, 1, 'per_stay', 40)").run(id, option);
  db.prepare('UPDATE reservations SET finalPrice = finalPrice - 20, balancePaid = 1, balanceAmount = finalPrice + touristTaxTotal WHERE id = ?').run(id);
  const row = overpaymentRow(await get(controller, id));
  assert.deepEqual(row.refundPrefill.overpaymentLines.map((l) => [l.bucket, l.amountTtc]), [['accommodation', 20]]);
});
