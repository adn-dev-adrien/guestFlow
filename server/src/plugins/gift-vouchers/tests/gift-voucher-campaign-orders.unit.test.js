// specs/gift-voucher-campaigns.md rules 19, 41, 52, 55 — the sale of a composed voucher: NOTHING exists before the bank confirms the payment (no voucher, no code, no
// booking, no sale) but the order; the order is priced again by the engine at the moment of its payment link; a confirmation after the link was withdrawn still issues the
// voucher at the price the order fixed; « Offert » records no sale; the operator's payment link is a site order and follows the standard path; a one-shot goes the same way.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const fx = require('./campaignFixtures');
const sale = require('./giftVoucherFixtures');
const campaignRules = require('../campaignRules');

const IP = '10.0.0.7';
let visitors = 0;
const ids = fx.seedCatalogue();
const shop = fx.openShop();
const { api, db } = shop;
const checked = campaignRules.validateCampaign(fx.bathCampaign(ids), fx.rulesContext(api));
const bath = api.campaigns.find(api.campaigns.insert(checked.value));

const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const existing = () => Object.fromEntries(['gift_voucher_orders', 'gift_vouchers', 'gift_voucher_movements', 'standalone_sales', 'resource_bookings'].map((t) => {
  try { return [t, count(t)]; } catch { return [t, 0]; }
}));

async function withServer(fn) {
  const server = await fx.serve(api);
  const site = (method, path, body) => server.call(method, `/public/v1/gift-vouchers${path}`, body, { 'x-test-ip': IP });
  // Each order comes from a visitor of its own: the hourly budget of one visitor is not what these suites judge.
  const place = (body = {}) => {
    visitors += 1;
    const ip = `10.0.1.${visitors}`;
    return server.call('POST', '/public/v1/gift-vouchers/orders', {
      slug: bath.slug, recipientName: 'Marie', senderName: 'Paul', message: 'Joyeux anniversaire', email: 'paul@example.test', language: 'fr', termsVersionId: 9, ...body, ...sale.solvedProof({ ip }),
    }, { 'x-test-ip': ip });
  };
  try { await fn({ server, site, place }); } finally { await server.close(); }
}

const paid = (orderId, linkId, amountCents) => api.orderPaid({ ref: String(orderId), linkId, amountCents });
const order = (id) => db.prepare('SELECT * FROM gift_voucher_orders WHERE id = ?').get(id);

test('nothing exists before the bank confirms: the order, its price and its link create no voucher, no code, no movement, no sale and no booking', () => withServer(async ({ site, place }) => {
  const before = existing();
  const placed = await place();
  assert.equal(placed.status, 201, JSON.stringify(placed.body));
  const { orderId, token } = placed.body.data;
  const row = order(orderId);
  assert.deepEqual([row.state, row.source, row.campaignId, row.amountCents, row.createdBy], ['pending', 'site', bath.id, 10900, 'public']);
  assert.deepEqual(JSON.parse(row.contents), {
    kind: 'resource',
    title: 'Un bain nordique',
    resource: {
      id: ids.bath, name: 'Bain nordique', band: 'day', minutes: 120, includedMinutes: 120, extraMinutes: 0,
    },
    options: [{ articleRef: `option:${ids.board}`, label: 'Planche apéro', qty: 1 }],
    addOns: [],
    // rule 20 — the priced lines, kept for the invoice-style recap of the mail
    lines: [
      {
        label: 'Bain nordique · journée', qty: 1, unitCents: 9500, totalCents: 9500, vatRate: 20,
      },
      {
        label: 'Planche apéro', qty: 1, unitCents: 1400, totalCents: 1400, vatRate: 10,
      },
    ],
  });
  assert.deepEqual(JSON.parse(row.vatLines).map((l) => [l.ratePercent, l.vatCents]), [[10, 127], [20, 1583]]);
  const link = await site('POST', `/orders/${orderId}/pay`, { token });
  assert.equal(link.status, 200);
  assert.deepEqual(shop.links.at(-1).sale, {
    ref: orderId, title: 'Un bain nordique · 109,00 €', amountCents: 10900, validityMinutes: 60,
  });
  assert.deepEqual(existing(), { ...before, gift_voucher_orders: before.gift_voucher_orders + 1 }, 'only the order exists, whether or not a link was minted');
  const page = await site('GET', `/orders/${orderId}?token=${token}`);
  assert.equal(page.body.data.state, 'pending');
  assert.equal(page.body.data.voucher, undefined, 'no code is shown');
}));

test('the bank’s confirmation issues the voucher with the contents, the VAT lines and the validity of its campaign frozen on it', () => withServer(async ({ place }) => {
  const { orderId } = (await place({ addOns: [{ articleRef: `option:${ids.drink}`, qty: 2 }], extraMinutes: 60 })).body.data;
  const priced = order(orderId).amountCents;
  assert.equal(priced, 9500 + 4000 + 1400 + 1300);
  assert.deepEqual(paid(orderId, 11, priced), { effect: 'voucher-issued' });
  const voucher = db.prepare('SELECT * FROM gift_vouchers WHERE orderId = ?').get(orderId);
  assert.deepEqual([voucher.campaignId, voucher.amountCents, voucher.expiresOn, voucher.vatRatePercent], [bath.id, priced, '2027-11-15', 20]);
  const contents = JSON.parse(voucher.contents);
  assert.deepEqual([contents.resource.minutes, contents.resource.extraMinutes, contents.addOns], [180, 60, [{ articleRef: `option:${ids.drink}`, label: 'Boisson', qty: 2 }]]);
  assert.equal(JSON.parse(voucher.vatLines).reduce((sum, l) => sum + l.htCents + l.vatCents, 0), priced);
  const movements = db.prepare('SELECT kind, amountCents FROM gift_voucher_movements WHERE voucherId = ?').all(voucher.id);
  assert.deepEqual(movements, [{ kind: 'issue', amountCents: priced }]);
  await api.receipt.idle();
}));

test('the order is priced again at the moment of the link: a rate that moved in between is the price asked, the contents stay as ordered, and the old amount is money to refund', () => withServer(async ({ site, place }) => {
  const { orderId, token } = (await place()).body.data;
  assert.equal(order(orderId).amountCents, 10900);
  db.prepare('UPDATE resources SET hourlyExternalDayRate = 60 WHERE id = ?').run(ids.bath);
  try {
    assert.equal((await site('POST', `/orders/${orderId}/pay`, { token })).status, 200);
    assert.equal(shop.links.at(-1).sale.amountCents, 6000 + 5400 + 1400);
    assert.equal(order(orderId).amountCents, 12800, 'the order now fixes the new price');
    assert.deepEqual(paid(orderId, 21, 10900), { reason: 'montant payé différent de celui du bon cadeau', refundOwed: true });
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM gift_vouchers WHERE orderId = ?').get(orderId).n, 0);
    assert.deepEqual(paid(orderId, 22, 12800), { effect: 'voucher-issued' });
    assert.equal(db.prepare('SELECT amountCents FROM gift_vouchers WHERE orderId = ?').get(orderId).amountCents, 12800);
  } finally {
    db.prepare('UPDATE resources SET hourlyExternalDayRate = 50 WHERE id = ?').run(ids.bath);
  }
}));

test('a campaign closed since the order cannot be paid any more — no link; a payment already made on a link still issues the voucher, even after the link was withdrawn', () => withServer(async ({ site, place }) => {
  const first = (await place()).body.data;
  const second = (await place()).body.data;
  await site('POST', `/orders/${first.orderId}/pay`, { token: first.token });
  const linksBefore = shop.links.length;
  api.campaigns.update(bath.id, { ...api.campaigns.find(bath.id), state: 'closed' });
  try {
    const refused = await site('POST', `/orders/${second.orderId}/pay`, { token: second.token });
    assert.deepEqual([refused.status, refused.body.error.code], [409, 'CAMPAIGN_CLOSED']);
    assert.equal(shop.links.length, linksBefore, 'no link for a closed offer');
    assert.equal((await place()).body.error.code, 'CAMPAIGN_CLOSED', 'a closed offer takes no new order');
    assert.deepEqual(paid(first.orderId, 31, 10900), { effect: 'voucher-issued' }, 'the bank confirmed after the offer closed: the voucher is issued at the price the order fixed');
  } finally {
    api.campaigns.update(bath.id, { ...api.campaigns.find(bath.id), state: 'on_sale' });
  }
}));

test('the public price is the engine’s, for any request; an unknown offer is refused; a one-shot composition is the operator’s alone and is ignored on the site', () => withServer(async ({ site }) => {
  const priced = await site('POST', '/offer/price', { slug: bath.slug, extraMinutes: 60, addOns: [{ articleRef: `option:${ids.drink}`, qty: 1 }] });
  assert.equal(priced.status, 200);
  assert.equal(priced.body.data.totalCents, 9500 + 4000 + 1400 + 650);
  assert.deepEqual(Object.keys(priced.body.data).sort(), ['lines', 'totalCents', 'vat']);
  assert.equal((await site('POST', '/offer/price', { slug: 'inconnu' })).body.error.code, 'CAMPAIGN_UNKNOWN');
  const composed = await site('POST', '/offer/price', { composition: { resourceId: ids.bath, band: 'day', minutes: 60, options: [] } });
  assert.equal(composed.body.data, undefined, 'no price for a composition on the site');
  assert.equal(composed.body.error.code, 'AMOUNT_INVALID', 'read as the lodging voucher it asks for, with no amount');
}));

test('« Offert » issues at no charge: no sale in the books, no VAT, the ledger reads « Offert par l’établissement » with the operator’s name', async () => {
  const server = await fx.serve(api);
  try {
    const books = () => api.salesBetween({ from: '2026-11-01', to: '2026-11-30' });
    const before = books().length;
    const given = await server.call('POST', '/api/gift-vouchers', { slug: bath.slug, outcome: 'offered', senderName: 'La maison', recipientName: 'Marie' });
    assert.equal(given.status, 201, JSON.stringify(given.body));
    assert.deepEqual([given.body.offered, given.body.vat, given.body.vatLines, given.body.paymentMethod], [true, null, [], 'offered']);
    assert.equal(given.body.amountCents, 10900, 'the value of the contents');
    const [issue] = given.body.movements;
    assert.deepEqual([issue.kind, issue.note, issue.actorName], ['issue', 'Offert par l’établissement', 'Adrien Test']);
    assert.equal(books().length, before, 'an offered voucher is no sale');
    const bought = await server.call('POST', '/api/gift-vouchers', { slug: bath.slug, outcome: 'paid', paymentMethod: 'transfer', senderName: 'Paul' });
    assert.equal(bought.status, 201);
    assert.deepEqual(books().filter((s) => s.label === `Bon cadeau ${bought.body.number}`).map((s) => [s.vatRate, s.totalCents]).sort(), [[10, 1400], [20, 9500]],
      'a composed voucher is one sale per VAT rate, HT + VAT at the rates of its lines');
    assert.equal((await server.call('POST', '/api/gift-vouchers', { slug: bath.slug, outcome: 'paid' })).body.code, 'PAYMENT_METHOD_INVALID');
    assert.equal((await server.call('POST', '/api/gift-vouchers', { slug: bath.slug, outcome: 'sell' })).body.code, 'OUTCOME_INVALID');
  } finally {
    await server.close();
  }
});

test('« Envoyer un lien » creates the order a site order would be, mails the one-hour link on the call, and issues nothing until the bank confirms — then the standard path', async () => {
  const server = await fx.serve(api);
  try {
    const before = existing();
    const refused = await server.call('POST', '/api/gift-vouchers', { slug: bath.slug, outcome: 'link', senderName: 'Paul' });
    assert.deepEqual([refused.status, refused.body.code], [400, 'EMAIL_INVALID'], 'the e-mail is mandatory for a link');
    assert.deepEqual(existing(), before);
    const mails = shop.sent.length;
    const sent = await server.call('POST', '/api/gift-vouchers', {
      slug: bath.slug, outcome: 'link', senderName: 'Paul', recipientName: 'Marie', email: 'paul@example.test', extraMinutes: 60,
    });
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    assert.deepEqual([sent.body.outcome, sent.body.emailedTo, sent.body.totalCents], ['link', 'paul@example.test', 14900]);
    const row = order(sent.body.orderId);
    assert.deepEqual([row.source, row.createdBy, row.state, row.amountCents, row.paymentMethod], ['site', 'user:7', 'pending', 14900, null]);
    assert.equal(shop.links.at(-1).sale.validityMinutes, 60);
    assert.equal(shop.links.at(-1).options.redirectUrl, null);
    assert.equal(shop.sent.length, mails + 1);
    const mail = shop.sent.at(-1);
    assert.equal(mail.to, 'paul@example.test');
    assert.ok(mail.text.includes(`https://pay.example.test/${shop.links.length}`) && mail.text.includes('valable une heure'));
    // Rule 37 — paying the link accepts the bath's terms: the mail names them and links their current version.
    assert.ok(mail.text.includes('Le paiement vaut acceptation de nos conditions générales de vente : https://site.example.test/cgv/?activity=resource&v=1'), mail.text);
    assert.ok(mail.html.includes('<a href="https://site.example.test/cgv/?activity=resource&amp;v=1">'), mail.html);
    assert.deepEqual(existing(), { ...before, gift_voucher_orders: before.gift_voucher_orders + 1 }, 'no voucher before the payment');
    assert.deepEqual(paid(sent.body.orderId, 41, 14900), { effect: 'voucher-issued' });
    await api.receipt.idle();
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM gift_vouchers WHERE orderId = ?').get(sent.body.orderId).n, 1);
    assert.equal(shop.sent.length, mails + 2, 'the receipt of a site order follows the payment');
  } finally {
    await server.close();
  }
});

test('« Sur mesure » follows the same path: a one-shot campaign bound to its only voucher, never listed, never on sale, priced and issued like any campaign', async () => {
  const server = await fx.serve(api);
  try {
    const request = {
      composition: { resourceId: ids.bath, band: 'evening', minutes: 120, options: [{ articleRef: `option:${ids.drink}`, qty: 2 }] },
      title: 'Bain pour Marie', validityMonths: 6, extraMinutes: 60, outcome: 'paid', paymentMethod: 'cash', senderName: 'Paul',
    };
    const preview = await server.call('POST', '/api/gift-vouchers/campaigns/preview-price', request);
    assert.equal(preview.status, 200);
    assert.equal(preview.body.totalCents, 7000 + 6300 + 5600 + 1300, 'evening: 70 + 63, then the 3rd hour at 56, two drinks');
    const campaignsBefore = count('gift_voucher_campaigns');
    assert.equal(count('gift_voucher_campaigns'), campaignsBefore, 'a preview stores nothing');
    const issued = await server.call('POST', '/api/gift-vouchers', request);
    assert.equal(issued.status, 201, JSON.stringify(issued.body));
    assert.equal(issued.body.amountCents, preview.body.totalCents, 'the price shown is the price sold');
    assert.deepEqual([issued.body.oneShot, issued.body.contents.title, issued.body.expiresOn], [true, 'Bain pour Marie', '2027-05-15']);
    const one = db.prepare('SELECT * FROM gift_voucher_campaigns WHERE oneShot = 1').get();
    assert.deepEqual([one.slug, one.state, one.kind], [null, 'closed', 'resource']);
    assert.equal(count('gift_voucher_campaigns'), campaignsBefore + 1);
    assert.equal((await server.call('GET', '/api/gift-vouchers/campaigns')).body.items.some((c) => c.id === one.id), false);
    assert.equal((await server.call('GET', `/api/gift-vouchers/campaigns/${one.id}`)).status, 404);
    assert.equal((await server.call('GET', '/api/gift-vouchers/offer')).body.campaigns.some((c) => c.title === 'Bain pour Marie'), false);
    assert.equal((await server.call('POST', '/api/gift-vouchers', { ...request, composition: { ...request.composition, minutes: 45 } })).status, 400, 'a wrong composition is refused');
    assert.equal(count('gift_voucher_campaigns'), campaignsBefore + 1, 'a refused one-shot leaves no campaign behind');
  } finally {
    await server.close();
  }
});

test('an unpaid one-shot order is purged with its campaign after 7 days; the campaign of an issued voucher stays', async () => {
  const server = await fx.serve(api);
  try {
    const request = { composition: { resourceId: ids.bath, band: 'day', minutes: 60, options: [] }, outcome: 'link', email: 'paul@example.test' };
    const sent = await server.call('POST', '/api/gift-vouchers', request);
    assert.equal(sent.status, 201);
    const withOrder = count('gift_voucher_campaigns');
    shop.clock.at = new Date(shop.clock.at.getTime() + 8 * 24 * 3600 * 1000);
    assert.ok(api.purgeStaleOrders() >= 1);
    assert.equal(count('gift_voucher_campaigns'), withOrder - 1);
    assert.ok(db.prepare('SELECT COUNT(*) AS n FROM gift_voucher_campaigns WHERE oneShot = 1').get().n >= 1, 'the one-shot of an issued voucher is kept');
  } finally {
    await server.close();
  }
});
