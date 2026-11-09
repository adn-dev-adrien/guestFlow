// specs/deposit-blocks-the-dates.md rule 20 (D23 stored row, audit R33 N1), rule 19.
// D23 reads a devis whose solde falls on or before its validity date as ONE payment. A row whose columns still hold
// an acompte — stored before the rule, or whose logement's « Solde dû … jours avant » changed since — disagreed with
// that read: its open deposit link stayed payable (the stale-link guard compares with the columns), and paying it
// converted the devis with 0 € of acompte, then asked the full price again as the solde.
// The columns now always agree with the read: a re-store at boot and at every logement save re-writes such an open
// devis as the single payment and withdraws the links billing the old split (D1: a withdrawn link is never paid).
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const f = require('./ledgerFixture');
const devisModel = require('../models/devisModel');
const propertiesModel = require('../models/propertiesModel');
const paymentLinksModel = require('../models/paymentLinksModel');
const { processPaidLink } = require('../utils/paymentPollRunner');
const { buildContext } = require('../utils/emailContextBuilder');

const { db, inDays } = f;
f.seed();
const links = paymentLinksModel.buildModel(db);

const pick = (r) => ({
  depositAmount: Number(r.depositAmount || 0),
  depositDueDate: r.depositDueDate || null,
  balanceAmount: Number(r.balanceAmount || 0),
  balanceDueDate: r.balanceDueDate || null,
});
const rowOf = (id) => db.prepare('SELECT * FROM reservations WHERE id = ?').get(Number(id));
const linkOf = (id) => db.prepare('SELECT * FROM payment_links WHERE id = ?').get(Number(id));

// A devis as a version before D23 stored it: acompte 120 due on the validity date, solde 280 due start − 30.
function legacyDevis({ startIn, validIn = 15, propertyId = 1, status = 'sent' }) {
  const start = inDays(startIn);
  const end = inDays(startIn + 2);
  const validUntil = inDays(validIn);
  const id = Number(db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults, totalPrice,
      finalPrice, depositAmount, depositDueDate, balanceAmount, balanceDueDate, devisStatus, validUntil, createdAt, platform)
    VALUES ('devis', ?, 1, ?, ?, 1, 400, 400, 120, ?, 280, ?, ?, ?, datetime('now'), 'direct')`)
    .run(propertyId, start, end, validUntil, inDays(startIn - 30), status, validUntil).lastInsertRowid);
  return { id, start, validUntil };
}
const openDepositLink = (devisId, cents = 12000) => links.create({
  reservationId: devisId, type: 'deposit', amountCents: cents, provider: 'qonto', providerLinkId: `L${devisId}`,
  url: 'https://pay.example.test/l', status: 'open', expiresAt: new Date(Date.now() + 30 * 3600 * 1000).toISOString(),
});
async function pay(link) {
  const calls = [];
  const out = await processPaidLink({
    database: db, devisModel, paymentLinksModel: links, emitPluginEvent: () => {},
    sendConfirmation: async (id) => calls.push(['confirm', id]),
    notifyPaidAfterCancel: async (x, o) => calls.push(['alert', x.id, o]),
    link: links.findById(link.id), paidPayment: { paid: true, paymentId: `p${link.id}`, paidAt: new Date().toISOString() },
  });
  return { out, calls };
}
const saveProperty = (id, body) => propertiesModel.update(id, body);
const setBalanceDays = async (days, id = 1) => saveProperty(id, { balanceDaysBefore: days });

test.beforeEach(async () => {
  await setBalanceDays(30, 1);
  await setBalanceDays(30, 2);
});

test('rule 20 — a devis stored with an acompte inside the window is re-stored as one payment at boot, its open deposit link withdrawn', async () => {
  const { id, validUntil } = legacyDevis({ startIn: 35 });
  const link = openDepositLink(id);

  const restored = devisModel.restoreSinglePayments();
  assert.ok(restored.includes(id), JSON.stringify(restored));
  assert.deepEqual(pick(rowOf(id)), { depositAmount: 0, depositDueDate: null, balanceAmount: 400, balanceDueDate: validUntil });
  assert.deepEqual(pick(devisModel.findById(id)), pick(rowOf(id)), 'the columns = the read');
  const retired = linkOf(link.id);
  assert.equal(retired.status, 'cancelled');
  assert.equal(retired.cancelReason, 'amount-changed');
  const history = db.prepare('SELECT changedFields FROM reservation_history WHERE reservationId = ? ORDER BY id').all(id)
    .map((h) => JSON.parse(h.changedFields)).flat().map((c) => c.field);
  assert.ok(history.includes('depositAmount') && history.includes('paymentLinkRetired'), JSON.stringify(history));

  // The e-mail tokens read the columns: one payment, due on the validity date, never the old acompte.
  const mail = buildContext({ reservation: rowOf(id), client: {}, property: {} });
  assert.equal(mail.vars.balanceDueDate, mail.vars.validUntil);
  assert.equal(mail.vars.depositDueDate, '', 'no acompte deadline announced');
  assert.equal(mail.vars.depositAmount, buildContext({ reservation: { depositAmount: 0 }, client: {}, property: {} }).vars.depositAmount);
  assert.equal(mail.vars.paymentAmount, mail.vars.balanceAmount, 'the payment asked is the whole pre-arrival total');
  assert.equal(mail.vars.balanceAmount, buildContext({ reservation: { balanceAmount: 400 }, client: {}, property: {} }).vars.balanceAmount);

  assert.deepEqual(devisModel.restoreSinglePayments(), [], 'idempotent: a second boot writes nothing');
});

test('rule 20 — an acompte link paid BEFORE the re-store converts at the stored split; the re-store then leaves the stay alone', async () => {
  const { id } = legacyDevis({ startIn: 35 });
  const link = openDepositLink(id);

  const { out, calls } = await pay(link);
  assert.equal(out.effect, 'converted', JSON.stringify(out));
  const rid = rowOf(id).convertedReservationId;
  const stay = rowOf(rid);
  assert.equal(stay.depositAmount, 120, 'the acompte the guest paid');
  assert.equal(Number(stay.depositPaid), 1);
  assert.equal(stay.balanceAmount, 280, 'the solde is the rest, never the full price again');
  assert.equal(Number(stay.balancePaid || 0), 0);
  assert.ok(calls.some(([kind]) => kind === 'confirm'));

  assert.ok(!devisModel.restoreSinglePayments().includes(id), 'a converted devis is never re-stored');
  assert.equal(rowOf(rid).depositAmount, 120);
  assert.equal(rowOf(id).depositAmount, 120, 'the converted devis keeps its record');
});

test('rule 20 — the logement\'s « Solde dû … jours avant » moves an open devis into the window: re-stored, its deposit link withdrawn', async () => {
  const { id, validUntil } = legacyDevis({ startIn: 50 });
  const link = openDepositLink(id);
  assert.equal(devisModel.findById(id).depositAmount, 120, 'outside the window: the acompte holds');

  await setBalanceDays(45);
  assert.deepEqual(pick(rowOf(id)), { depositAmount: 0, depositDueDate: null, balanceAmount: 400, balanceDueDate: validUntil });
  assert.deepEqual(pick(devisModel.findById(id)), pick(rowOf(id)));
  assert.equal(linkOf(link.id).status, 'cancelled');
  assert.equal(linkOf(link.id).cancelReason, 'amount-changed');

  // Back to 30 days: the single payment stays one payment, and the columns still agree with the read.
  await setBalanceDays(30);
  assert.deepEqual(pick(devisModel.findById(id)), pick(rowOf(id)), 'out of the window again: columns = read');
});

test('rule 20 — out of reach: a devis outside the window, a converted one, another logement\'s', async () => {
  const outside = legacyDevis({ startIn: 70 });
  const outsideLink = openDepositLink(outside.id);
  const other = legacyDevis({ startIn: 50, propertyId: 2 });
  const otherLink = openDepositLink(other.id);

  await setBalanceDays(45, 1);
  assert.equal(rowOf(outside.id).depositAmount, 120, 'start − 45 still after the validity date: the acompte stays');
  assert.equal(linkOf(outsideLink.id).status, 'open');
  assert.equal(rowOf(other.id).depositAmount, 120, 'another logement\'s devis is not touched by this save');
  assert.equal(linkOf(otherLink.id).status, 'open');

  const converted = legacyDevis({ startIn: 35 });
  db.prepare("UPDATE reservations SET devisStatus = 'converted' WHERE id = ?").run(converted.id);
  assert.ok(!devisModel.restoreSinglePayments().includes(converted.id));
  assert.equal(rowOf(converted.id).depositAmount, 120);
});

test('rule 20 — the server re-stores at every boot, before it answers', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  const call = source.indexOf('restoreSinglePayments(');
  assert.ok(call > 0, 'index.js runs the re-store');
  assert.ok(call < source.indexOf('serverHandle.listen('), 'before the server listens');
});

test('rule 20 — a legacy devis stored without a validity date is judged on the date it reads, like its link quote', () => {
  const id = Number(db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults, totalPrice,
      finalPrice, depositAmount, depositDueDate, balanceAmount, balanceDueDate, devisStatus, validUntil, createdAt, platform)
    VALUES ('devis', 1, 1, ?, ?, 1, 400, 400, 120, NULL, 280, ?, 'draft', NULL, datetime('now'), 'direct')`)
    .run(inDays(35), inDays(37), inDays(5)).lastInsertRowid);
  const read = devisModel.findById(id);
  assert.ok(read.validUntil, 'the fiche shows the validity the row would carry');
  assert.equal(read.depositAmount, 0, 'read on that validity: one payment');
  assert.equal(devisModel.recomputeQuote(id).depositAmount, 0, 'the link quote agrees');
  assert.ok(devisModel.restoreSinglePayments().includes(id));
  assert.deepEqual(pick(rowOf(id)), { depositAmount: 0, depositDueDate: null, balanceAmount: 400, balanceDueDate: read.validUntil });
  assert.deepEqual(pick(devisModel.findById(id)), pick(rowOf(id)));
});
