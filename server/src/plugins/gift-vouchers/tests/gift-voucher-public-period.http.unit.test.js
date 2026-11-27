// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md K1 — through the real public router: a price or an order that names `period: 'weekend'` is priced and kept on the weekend, one that names
// no period gets the campaign's cheapest offered period (a connector older than the period still works), and the request keys the controller reads name `period`.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const f = require('./periodFixtures');
const fx = require('./campaignFixtures');
const sale = require('./giftVoucherFixtures');

const s = f.setup();
s.campaign('une-heure', 'day');
let visitors = 0;

const withServer = async (fn) => {
  const server = await fx.serve(s.api);
  try { await fn(server); } finally { await server.close(); }
};
const BASE = '/public/v1/gift-vouchers';

test('the request keys of the public order controller name « period »', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'publicOrdersController.js'), 'utf8');
  assert.match(source, /const REQUEST_KEYS = Object\.freeze\(\[[^\]]*'period'[^\]]*\]\)/);
});

test('POST /offer/price: the weekend is priced as the weekend, the week as the week, and no period as the cheapest', () => withServer(async (server) => {
  const price = async (body) => (await server.call('POST', `${BASE}/offer/price`, { slug: 'une-heure', ...body }, { 'x-test-ip': '10.0.2.1' })).body.data.totalCents;
  const week = await price({ period: 'week' });
  const weekend = await price({ period: 'weekend' });
  assert.equal([week, weekend].every((cents) => cents > 0), true);
  assert.ok(weekend > week, 'the weekend costs more on the production grid');
  assert.equal(await price({}), Math.min(week, weekend), 'a request without a period gets the cheapest offered one');
}));

test('POST /orders: an order that names the weekend is stored and priced on the weekend; one with no period gets the cheapest', () => withServer(async (server) => {
  const place = async (body) => {
    visitors += 1;
    const ip = `10.0.3.${visitors}`;
    const placed = await server.call('POST', `${BASE}/orders`, {
      slug: 'une-heure', recipientFirstName: 'Marie', recipientLastName: 'Durand', senderName: 'Paul', message: '', email: 'paul@example.test', language: 'fr', termsVersionId: 9, ...body, ...sale.solvedProof({ ip }),
    }, { 'x-test-ip': ip });
    assert.equal(placed.status, 201, JSON.stringify(placed.body));
    const row = s.db.prepare('SELECT * FROM gift_voucher_orders WHERE id = ?').get(placed.body.data.orderId);
    return { period: JSON.parse(row.contents).resource.period, cents: row.amountCents };
  };
  const weekend = await place({ period: 'weekend' });
  const week = await place({ period: 'week' });
  const none = await place({});
  assert.equal(weekend.period, 'weekend');
  assert.equal(week.period, 'week');
  assert.ok(weekend.cents > week.cents);
  assert.deepEqual(none, week, 'no period → the cheapest');
}));

test('a period the campaign does not offer is refused on every public path', () => withServer(async (server) => {
  s.campaign('semaine', 'day', ['week']);
  const refused = await server.call('POST', `${BASE}/offer/price`, { slug: 'semaine', period: 'weekend' }, { 'x-test-ip': '10.0.2.9' });
  assert.equal(refused.status >= 400, true, JSON.stringify(refused.body));
}));
