// specs/payment-link-lifecycle.md rule 50 (audit R9-C1) — « Relancer » / « Envoyer la demande » on the home's
// « Échéances de paiement » card reaches the request service; a business refusal it throws (409 LINK_ALREADY_PAID:
// the payment was just booked) is answered with its own status and code, so the card can re-read its rows. Only an
// unknown failure stays 502 REMINDER_FAILED.
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildController } = require('../controllers/dashboardController');
require('../utils/platformNameFormat').setDirectChannels([]);

const PAID_BOOKED = { httpStatus: 409, error: 'LINK_ALREADY_PAID', message: 'Le lien en cours vient d’être payé : paiement enregistré, aucun nouveau lien créé.' };

async function remind(thrown, type = 'deposit') {
  const res = {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  const fail = async () => { throw thrown; };
  await buildController({
    reservationsModel: { getPlatform: () => 'direct' },
    sendDepositRequest: fail,
    sendBalanceRequest: fail,
    hasPaymentProvider: () => true,
  }).remindPaymentDeadline({ params: { id: '7' }, body: { type } }, res);
  return res;
}

test('rule 50: a request refused as already paid answers 409 LINK_ALREADY_PAID, not 502', async () => {
  for (const type of ['deposit', 'balance']) {
    const res = await remind({ ...PAID_BOOKED }, type);
    assert.equal(res.statusCode, 409);
    assert.deepEqual(res.body, { error: 'LINK_ALREADY_PAID', message: PAID_BOOKED.message });
  }
});

test('rule 50: any service refusal keeps its status and code (here an échéance already collected)', async () => {
  const res = await remind({ httpStatus: 409, error: 'ALREADY_PAID', message: 'Cette échéance est déjà perçue : aucun lien à créer.' });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'ALREADY_PAID');
});

test('rule 50: an unknown failure is still 502 REMINDER_FAILED', async () => {
  const res = await remind(new Error('socket hang up'));
  assert.equal(res.statusCode, 502);
  assert.deepEqual(res.body, { error: 'REMINDER_FAILED', message: 'socket hang up' });
});
