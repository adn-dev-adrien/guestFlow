// specs/plugins-phase-3a-online-payment.md rule 47 (audit R6 N1): an open link owned by the stay itself, paid after
// a `performUpdate` re-price, is booked at what was received (ledger rule 47) AND raises the « autre montant »
// alert with no confirmation, exactly like the devis-owned twin (public-online-payment rule 14).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const paymentLinksModel = require('../models/paymentLinksModel');
const devisModel = require('../models/devisModel');
const { processPaidLink } = require('../utils/paymentPollRunner');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
const DAY = '2027-03-01';

function seed({ asDevis }) {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'J', 'D', 'j@x.fr')").run();
  const id = Number(db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults, finalPrice, depositAmount, balanceAmount, devisStatus)
    VALUES (?, 1, 1, '2027-05-10', '2027-05-14', 1, 455.36, 100, 355.36, ?)`).run(asDevis ? 'devis' : 'reservation', asDevis ? 'draft' : null).lastInsertRowid);
  const links = paymentLinksModel.buildModel(db);
  const dm = devisModel.buildModel(db);
  const F = links.create({ reservationId: id, type: 'full', amountCents: 45536, provider: 'qonto', providerLinkId: 'F', url: 'u', status: 'open' });
  const rid = asDevis ? dm.convertToReservation(id).data.reservationId : id;
  const calls = [];
  const common = {
    database: db, devisModel: dm, paymentLinksModel: Object.assign(Object.create(links), { retireSettled: () => [] }),
    sendConfirmation: async (x) => calls.push(['confirm', x]), notifyPaidAfterCancel: async (l, o) => calls.push(['alert', l.id, o]), emitPluginEvent: () => {},
  };
  return {
    db, rid, calls,
    reprice: (balance) => db.prepare('UPDATE reservations SET balanceAmount = ?, finalPrice = ? WHERE id = ?').run(balance, 100 + balance, rid),
    tick: () => db.prepare('UPDATE reservations SET depositPaid = 1, depositPaidDate = ? WHERE id = ?').run(DAY, rid),
    pay: () => processPaidLink({ ...common, link: links.findById(F.id), paidPayment: { paid: true, paymentId: 'pF', paidAt: `${DAY}T09:00:00Z` } }),
    row: () => db.prepare('SELECT * FROM reservations WHERE id = ?').get(rid),
  };
}

const CASES = [
  { label: 'grown', balance: 455.36, expectedCents: 55536, complement: 100 },
  { label: 'shrunk', balance: 255.36, expectedCents: 35536, complement: 0 },
];

for (const asDevis of [false, true]) {
  for (const { label, balance, expectedCents, complement } of CASES) {
    for (const ticked of [false, true]) {
      if (asDevis && ticked) continue;
      test(`rule 47: ${asDevis ? 'devis' : 'stay'}-owned full link, ${label}${ticked ? ', acompte ticked the same day' : ''} — alert, no confirmation`, async () => {
        const s = seed({ asDevis });
        s.reprice(balance);
        if (ticked) s.tick();
        const out = await s.pay();
        assert.deepEqual(out.amountMismatch, { expectedCents, receivedCents: 45536 });
        assert.deepEqual(s.calls, [['alert', 1, { amountMismatch: { expectedCents, receivedCents: 45536 } }]]);
        const row = s.row();
        assert.equal(row.depositPaid, 1);
        assert.equal(row.balancePaid, 1);
        assert.equal(row.depositAmount, 100);
        assert.equal(row.balanceAmount, 355.36);
        assert.equal(row.complementAmount || 0, complement);
      });
    }
  }
}

test('rule 47: a stay-owned link whose amount still matches keeps the normal confirmation', async () => {
  const s = seed({ asDevis: false });
  const out = await s.pay();
  assert.equal(out.amountMismatch, undefined);
  assert.deepEqual(s.calls, [['confirm', s.rid]]);
});

// Rule 47, acompte links: the booking records the acompte at the link amount and the solde absorbs the
// difference, so the alert states that and neither a complement nor a trop-perçu; the confirmation goes out.
const { __test: { buildPaidAfterCancelEmail } } = require('../utils/notificationService');

function seedDeposit({ asDevis }) {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'J', 'D', 'j@x.fr')").run();
  const id = Number(db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults, finalPrice, depositAmount, balanceAmount, devisStatus)
    VALUES (?, 1, 1, '2027-05-10', '2027-05-14', 1, 455.36, 100, 355.36, ?)`).run(asDevis ? 'devis' : 'reservation', asDevis ? 'draft' : null).lastInsertRowid);
  const links = paymentLinksModel.buildModel(db);
  const dm = devisModel.buildModel(db);
  const D = links.create({ reservationId: id, type: 'deposit', amountCents: 10000, provider: 'qonto', providerLinkId: 'D', url: 'u', status: 'open' });
  const rid = asDevis ? dm.convertToReservation(id).data.reservationId : id;
  const calls = [];
  const common = {
    database: db, devisModel: dm, paymentLinksModel: Object.assign(Object.create(links), { retireSettled: () => [] }),
    sendConfirmation: async (x) => calls.push(['confirm', x]), notifyPaidAfterCancel: async (l, o) => calls.push(['alert', l.id, o]), emitPluginEvent: () => {},
  };
  return {
    db, rid, calls, D,
    reprice: (deposit, balance) => db.prepare('UPDATE reservations SET depositAmount = ?, balanceAmount = ?, finalPrice = ? WHERE id = ?').run(deposit, balance, deposit + balance, rid),
    pay: () => processPaidLink({ ...common, link: links.findById(D.id), paidPayment: { paid: true, paymentId: 'pD', paidAt: `${DAY}T09:00:00Z` } }),
    text: (resaId, alert) => buildPaidAfterCancelEmail(db.prepare('SELECT * FROM reservations WHERE id = ?').get(resaId), links.findById(D.id), '', alert).text,
  };
}

for (const asDevis of [false, true]) {
  for (const [deposit, balance, solde, label] of [[120, 335.36, '355,36', 'grown'], [80, 375.36, '355,36', 'shrunk']]) {
    test(`rule 47: ${asDevis ? 'devis' : 'stay'}-owned acompte link, acompte ${label} — says what was booked, no complement nor trop-perçu, confirmation sent`, async () => {
      const s = seedDeposit({ asDevis });
      s.reprice(deposit, balance);
      await s.pay();
      const kinds = s.calls.map((c) => c[0]).sort();
      assert.deepEqual(kinds, ['alert', 'confirm']);
      const alert = s.calls.find((c) => c[0] === 'alert')[2];
      const text = s.text(s.D.reservationId, alert);
      assert.match(text, new RegExp(`Acompte enregistré à 100,00\\s€ \\(${deposit},00\\s€ demandés\\) ; solde porté à ${solde}\\s€\\.`));
      assert.doesNotMatch(text, /Trop-perçu|complément d’arrivée|une fois la différence réglée/);
      assert.doesNotMatch(text, /Aucun e-mail de confirmation/);
      assert.match(text, asDevis ? /le devis demande/ : /le séjour demande/);
      const row = s.db.prepare('SELECT * FROM reservations WHERE kind = ? ORDER BY id DESC').get('reservation');
      assert.equal(row.depositAmount, 100);
      assert.equal(row.balanceAmount, 355.36);
      assert.equal(row.complementAmount || 0, 0);
    });
  }
}

test('rule 47: a stay-owned full link alert says « le séjour », not « le devis »', () => {
  const link = { id: 1, amountCents: 45536 };
  const mismatch = { expectedCents: 55536, receivedCents: 45536 };
  assert.match(buildPaidAfterCancelEmail({ id: 1, kind: 'reservation' }, link, '', { amountMismatch: mismatch }).text, /alors que le séjour demande aujourd’hui/);
  assert.match(buildPaidAfterCancelEmail({ id: 1, kind: 'devis' }, link, '', { amountMismatch: mismatch }).text, /alors que le devis demande aujourd’hui/);
});

const { storedOverpaymentOf } = require('../utils/overpayment');

test('rule 47 (E1): an acompte link paid above the whole pre-arrival total names the trop-perçu and holds the confirmation', async () => {
  const s = seedDeposit({ asDevis: false });
  s.reprice(30, 50);
  await s.pay();
  assert.deepEqual(s.calls.map((c) => c[0]), ['alert']);
  const text = s.text(s.D.reservationId, s.calls[0][2]);
  assert.match(text, /Acompte enregistré à 100,00\s€ \(30,00\s€ demandés\) ; solde porté à 0,00\s€\./);
  assert.match(text, /Trop-perçu de 20,00\s€ à rembourser\./);
  assert.match(text, /Aucun e-mail de confirmation n’a été envoyé au client\./);
  assert.equal(storedOverpaymentOf({ row: s.db.prepare('SELECT * FROM reservations WHERE id = ?').get(s.rid), captured: {} }), 20);
});

test('rule 47 (B3): a full link paid below the acompte is worded as an acompte, not as a complement', async () => {
  const s = seedDeposit({ asDevis: false });
  s.db.prepare("UPDATE payment_links SET type = 'full', amountCents = 8000 WHERE id = ?").run(s.D.id);
  await s.pay();
  assert.deepEqual(s.calls.map((c) => c[0]).sort(), ['alert', 'confirm']);
  const text = s.text(s.D.reservationId, s.calls.find((c) => c[0] === 'alert')[2]);
  assert.match(text, /Acompte enregistré à 80,00\s€ \(100,00\s€ demandés\) ; solde porté à 375,36\s€\./);
  assert.doesNotMatch(text, /complément d’arrivée/);
  assert.doesNotMatch(text, /Aucun e-mail de confirmation/);
});

test('rule 47 (F1): the `settled` retry of a full link paid below the acompte is worded as an acompte too', async () => {
  const { retryPendingCancellations } = require('../utils/paymentPollRunner');
  const s = seedDeposit({ asDevis: false });
  s.db.prepare("UPDATE payment_links SET type = 'full', amountCents = 8000 WHERE id = ?").run(s.D.id);
  s.db.prepare('UPDATE reservations SET depositPaid = 1, depositPaidDate = ? WHERE id = ?').run(DAY, s.rid);
  const links = paymentLinksModel.buildModel(s.db);
  links.retireSettled();
  const calls = [];
  const provider = { id: 'qonto', async getPayment() { return { paid: true, paymentId: 'pD', paidAt: `${DAY}T09:00:00Z` }; }, async cancelLink() {} };
  await retryPendingCancellations({
    database: s.db, devisModel: devisModel.buildModel(s.db), paymentLinksModel: links, provider,
    sendConfirmation: async () => {}, notifyPaidAfterCancel: async (l, o) => calls.push(o), emitPluginEvent: () => {},
  });
  assert.equal(calls.length, 1);
  const text = s.text(s.D.reservationId, calls[0]);
  assert.match(text, /Acompte enregistré à 80,00\s€ \(100,00\s€ demandés\) ; solde porté à 375,36\s€\./);
  assert.doesNotMatch(text, /complément d’arrivée/);
});
