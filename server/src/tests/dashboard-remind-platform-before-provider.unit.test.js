// specs/platform-payout-due-date.md rules 20 + 39 (2026-10-27 spec review) — a platform stay is refused with
// 400 PLATFORM_RESERVATION even when no payment provider is connected: the reason it gets no reminder
// does not depend on the configuration, and 409 NO_PAYMENT_PROVIDER would tell the operator to connect
// a provider for a reminder that must never be sent.
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildController } = require('../controllers/dashboardController');
require('../utils/platformNameFormat').setDirectChannels([]);

async function remind(platform) {
  const sent = [];
  const res = {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  await buildController({
    reservationsModel: { getPlatform: () => platform },
    sendBalanceRequest: async (id) => { sent.push(id); return { httpStatus: 200, body: { ok: true } }; },
    hasPaymentProvider: () => false,
  }).remindPaymentDeadline({ params: { id: '7' }, body: { type: 'balance' } }, res);
  return { res, sent };
}

test('no provider connected: a platform stay is still refused as a platform stay', async () => {
  const { res, sent } = await remind('Airbnb');
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'PLATFORM_RESERVATION');
  assert.deepEqual(sent, []);
});

test('no provider connected: a direct stay gets 409 NO_PAYMENT_PROVIDER', async () => {
  const { res, sent } = await remind('direct');
  assert.equal(res.statusCode, 409);
  assert.deepEqual(sent, []);
});
