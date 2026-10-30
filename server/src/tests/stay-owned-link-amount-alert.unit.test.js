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
