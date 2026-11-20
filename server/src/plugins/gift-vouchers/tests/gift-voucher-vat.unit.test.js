// specs/gift-vouchers.md rules 43-44 — the VAT of a voucher: the setting and its refusals, the rate frozen on the voucher when it is sold
// (by hand or on the site), HT / VAT cut from the TTC to the cent, the receipt's variable, nothing on the printed voucher, the existing
// vouchers backfilled to 10 %, and the sale as the books read it (HT + VAT at the frozen rate).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const rules = require('../voucherRules');
const settings = require('../settings');
const { MIGRATIONS } = require('../migrations');
const { skipWithout } = require('../../sdk/testing');
const fx = require('./giftVoucherFixtures');

const campaignRules = require('../campaignRules');

// The rate is a lodging campaign's field (specs/gift-voucher-campaigns.md rule 3): its form judges it.
const rateError = (value) => {
  const found = campaignRules.validateCampaign({
    name: 'N', title: 'T', kind: 'lodging', validityMonths: 18, minAmountCents: 2000, maxAmountCents: 200000, vatRatePercent: value,
  }, { catalogue: {}, campaigns: { findBySlug: () => null } });
  const error = found.ok ? null : found.errors.find((e) => e.field === 'vatRatePercent');
  return error ? error.message.replace(/^Taux de TVA : /, '') : null;
};

async function withShop(fn, over = {}) {
  const fixture = fx.buildApi(undefined, over);
  const server = await fx.start(fixture);
  try {
    await fn({ ...fixture, server });
  } finally {
    await server.close();
  }
}

test('rule 43: the lodging campaign starts at 10 %, whatever the settings held before, and reads the rate it was saved with', () => {
  assert.equal(rules.DEFAULT_VAT_PERCENT, 10);
  assert.equal(fx.buildApi().api.campaigns.firstLodging().vatRatePercent, 10);
  const { api } = fx.buildApi();
  fx.setLodging(api, { vatRatePercent: '5,5' });
  assert.equal(api.campaigns.firstLodging().vatRatePercent, 5.5);
  fx.setLodging(api, { vatRatePercent: '0' });
  assert.equal(api.campaigns.firstLodging().vatRatePercent, 0);
});

test('rule 43: a rate is 0 to 100 with at most two decimals — each refusal has its own sentence, a comma or a point is accepted', () => {
  const refused = rateError;
  assert.equal(refused(''), 'Saisir un taux (0 si les bons ne portent pas de TVA).');
  assert.equal(refused('   '), 'Saisir un taux (0 si les bons ne portent pas de TVA).');
  assert.equal(refused('abc'), 'Saisir un nombre, par exemple 10 ou 5,5.');
  assert.equal(refused('-5'), 'Saisir un nombre, par exemple 10 ou 5,5.');
  assert.equal(refused('1e1'), 'Saisir un nombre, par exemple 10 ou 5,5.');
  assert.equal(refused('10,555'), 'Deux décimales au plus.');
  assert.equal(refused('0.001'), 'Deux décimales au plus.');
  assert.equal(refused('120'), 'Saisir un taux entre 0 et 100 %.');
  assert.equal(refused('100,01'), 'Saisir un taux entre 0 et 100 %.');
  for (const ok of ['0', '10', '5,5', '5.5', '20', '19,6', '100', ' 7 ', 10, 5.5, '0,01']) assert.equal(refused(ok), null, String(ok));
});

test('rule 43: HT = round(TTC / (1 + rate)), VAT = TTC − HT, to the cent — 150 € at 10 % is 136,36 + 13,64', () => {
  assert.deepEqual(rules.vatSplit(15000, 10), { ratePercent: 10, htCents: 13636, vatCents: 1364 });
  assert.deepEqual(rules.vatSplit(15000, 5.5), { ratePercent: 5.5, htCents: 14218, vatCents: 782 });
  assert.deepEqual(rules.vatSplit(15000, 20), { ratePercent: 20, htCents: 12500, vatCents: 2500 });
  assert.deepEqual(rules.vatSplit(15000, 0), { ratePercent: 0, htCents: 15000, vatCents: 0 });
  assert.deepEqual(rules.vatSplit(2001, 19.6), { ratePercent: 19.6, htCents: 1673, vatCents: 328 });
  assert.deepEqual(rules.vatSplit(100, 100), { ratePercent: 100, htCents: 50, vatCents: 50 });
  for (const cents of [2000, 2001, 9999, 12345, 200000]) {
    for (const rate of [0, 2.1, 5.5, 10, 19.6, 20]) {
      const { htCents, vatCents } = rules.vatSplit(cents, rate);
      assert.equal(htCents + vatCents, cents, `${cents} at ${rate}`);
    }
  }
  assert.equal(rules.formatPercent(10), '10 %');
  assert.equal(rules.formatPercent(5.5), '5,5 %');
});

test('rule 43: a voucher sold by hand carries the rate in force that day — a later change never moves it, a new voucher takes the new one', () => withShop(async ({
  server, api, db,
}) => {
  const first = await fx.issueManual(server);
  assert.deepEqual(first.vat, { ratePercent: 10, htCents: 13636, vatCents: 1364 });
  fx.setLodging(api, { vatRatePercent: '5,5' });
  const second = await fx.issueManual(server);
  assert.deepEqual(second.vat, { ratePercent: 5.5, htCents: 14218, vatCents: 782 });
  const reread = await server.call('GET', `/api/gift-vouchers/${first.id}`);
  assert.deepEqual(reread.body.vat, { ratePercent: 10, htCents: 13636, vatCents: 1364 }, 'the first voucher keeps its 10 %');
  assert.deepEqual(db.prepare('SELECT vatRatePercent FROM gift_vouchers ORDER BY id').all().map((r) => r.vatRatePercent), [10, 5.5]);
}));

test('rule 43: a voucher sold on the site is frozen when the bank confirms it, at the rate then in force', () => withShop(async ({
  api, db,
}) => {
  const placed = (amountCents) => api.orders.create({ amountCents, email: 'paul@example.test', source: 'site' });
  const a = placed(15000);
  const b = placed(15000);
  fx.setLodging(api, { vatRatePercent: '20' });
  api.orderPaid({ ref: String(a.id), linkId: 51, amountCents: 15000 });
  fx.setLodging(api, { vatRatePercent: '0' });
  api.orderPaid({ ref: String(b.id), linkId: 52, amountCents: 15000 });
  assert.deepEqual(db.prepare('SELECT orderId, vatRatePercent FROM gift_vouchers ORDER BY id').all(), [
    { orderId: a.id, vatRatePercent: 20 }, { orderId: b.id, vatRatePercent: 0 },
  ]);
  await api.receipt.idle();
}));

test('rule 43: the receipt’s recap (rule 20 of the campaigns spec) says the VAT in the buyer’s language — « dont TVA 10 % : 13,64 € » — and says nothing for a voucher with no VAT', () => withShop(async ({
  api, sent,
}) => {
  const placed = (extra) => api.orders.create({
    amountCents: 15000, email: 'paul@example.test', source: 'site', ...extra,
  });
  const fr = placed();
  const en = placed({ language: 'en' });
  api.orderPaid({ ref: String(fr.id), linkId: 61, amountCents: 15000 });
  api.orderPaid({ ref: String(en.id), linkId: 62, amountCents: 15000 });
  fx.setLodging(api, { vatRatePercent: '0' });
  const free = placed();
  api.orderPaid({ ref: String(free.id), linkId: 63, amountCents: 15000 });
  await api.receipt.idle();
  const [frMail, enMail, freeMail] = sent;
  assert.match(frMail.text, /Total payé TTC : 150,00 €\ndont TVA 10 % : 13,64 €/);
  assert.match(frMail.html, /dont TVA 10 % : 13,64 €/);
  assert.match(enMail.text, /Total paid incl\. VAT: 150,00 €\nincluding VAT 10%: 13,64 €/);
  assert.match(freeMail.text, /Total payé TTC : 150,00 €/);
  assert.equal(/dont TVA/.test(freeMail.text), false, 'no VAT sentence for a voucher with no VAT');
}));

test('rule 43: the plugin declares no mail template any more — the mail is built from the voucher (rule 20 of the campaigns spec)', () => {
  assert.deepEqual(settings.DECLARED.map((d) => d.key), ['pageUrl', 'linkBase']);
});

test('rule 43: the VAT is on the operator’s detail and the receipt, never on the printed voucher', () => {
  const pdf = fs.readFileSync(path.join(__dirname, '..', 'voucherPdf.js'), 'utf8');
  assert.equal(/tva|\bvat\b|vatRate/i.test(pdf), false);
  const page = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'publicOrdersController.js'), 'utf8');
  assert.equal(/vatRate|vatSplit/.test(page), false, 'the buyer’s voucher page does not carry it either');
});

test('rule 43: the migration adds the column and the vouchers sold before it are backfilled to 10 %', () => {
  const db = new Database(':memory:');
  MIGRATIONS[0].up(db);
  db.prepare("INSERT INTO gift_voucher_orders (amountCents, source, createdAt) VALUES (5000, 'manual', '2026-11-01T10:00:00Z')").run();
  db.prepare("INSERT INTO gift_vouchers (orderId, number, codeHash, codeEncrypted, amountCents, issuedAt, expiresOn) VALUES (1, 'BC-2026-0001', 'h', 'e', 5000, '2026-11-01T10:00:00Z', '2028-05-01')").run();
  assert.equal(MIGRATIONS[1].name, 'gift_vouchers_vat_v1');
  MIGRATIONS[1].up(db);
  assert.equal(db.prepare('SELECT vatRatePercent FROM gift_vouchers').get().vatRatePercent, 10);
  assert.throws(() => MIGRATIONS[1].up(db), /duplicate column/);
});

test('rule 44: each voucher is a sale of its collection day, at its frozen rate; a card taken by hand is a card sale, the site’s payment is not', () => withShop(async ({
  api, server, clock,
}) => {
  await fx.issueManual(server, { paymentMethod: 'card' });
  fx.setLodging(api, { vatRatePercent: '5,5' });
  await fx.issueManual(server, { paymentMethod: 'transfer', amountCents: 5000, senderName: 'Paul' });
  const site = api.orders.create({ amountCents: 20000, email: 'x@example.test', source: 'site' });
  clock.at = new Date('2026-11-16T23:30:00Z');
  api.orderPaid({ ref: String(site.id), linkId: 71, amountCents: 20000 });
  const sales = api.salesBetween({ from: '2026-11-01', to: '2026-11-30' });
  assert.deepEqual(sales.map((s) => [s.date, s.totalCents, s.booksCents, s.cardCents, s.vatRate, s.label]), [
    ['2026-11-15', 15000, 15000, 15000, 10, 'Bon cadeau BC-2026-0001'],
    ['2026-11-15', 5000, 5000, 0, 5.5, 'Bon cadeau BC-2026-0002'],
    ['2026-11-17', 20000, 20000, 0, 5.5, 'Bon cadeau BC-2026-0003'],
  ], 'a payment at 23:30 UTC is the next Paris day');
  assert.deepEqual(api.salesBetween({ from: '2026-11-16', to: '2026-11-16' }), []);
  assert.equal(api.salesBetween({ from: '2026-11-17', to: '2026-11-17' })[0].key, `giftVoucher:${sales[2].key.split(':')[1]}`);
  await api.receipt.idle();
}));

test('rule 44: the journal books a sale as HT + VAT — 150 € at 10 % debits 150,00 and credits 136,36 and 13,64', { skip: skipWithout(['accounting-export']) }, () => {
  const accountPlan = require('../../accounting-export/accountPlan');
  const { buildStandaloneEntry } = require('../../../utils/accounting/accountingOutput');
  const { entryLines } = require('../../../utils/accounting/journalLines').create({ accountPlan });
  const sale = {
    key: 'giftVoucher:1', date: '2026-11-15', totalCents: 15000, booksCents: 15000, cardCents: 0, label: 'Bon cadeau BC-2026-0001', client: { firstName: '', lastName: 'Paul' }, vatRate: 10, invoiceNumber: null,
  };
  const lines = entryLines(buildStandaloneEntry(sale)).map((l) => [l.role.split(':')[0], l.side, l.amountCents ?? Math.round(l.amount * 100)]);
  assert.deepEqual(lines, [['customer', 'debit', 15000], ['revenue', 'credit', 13636], ['vat', 'credit', 1364]]);
});
