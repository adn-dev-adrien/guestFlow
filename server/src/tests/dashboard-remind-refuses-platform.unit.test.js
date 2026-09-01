// specs/platform-payout-due-date.md rule 20 — le point d'entrée de relance REFUSE une réservation
// non directe.
//
// Pourquoi ce fichier existe : la carte cache déjà le bouton « Relancer » sur une ligne plateforme
// (règle 16), mais cacher un bouton n'est pas une garantie — un client resté ouvert depuis une heure,
// un appel direct à l'API, et un client d'Airbnb reçoit une demande de paiement pour de l'argent
// qu'il a DÉJÀ versé à la plateforme. C'est l'email le plus embarrassant que GuestFlow puisse
// envoyer, et rien ne le testait.
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildController } = require('../controllers/dashboardController');

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function controllerFor(platform, sent) {
  return buildController({
    reservationsModel: { getPlatform: () => platform },
    sendDepositRequest: async (id) => { sent.push(['deposit', id]); return { httpStatus: 200, body: { ok: true } }; },
    sendBalanceRequest: async (id) => { sent.push(['balance', id]); return { httpStatus: 200, body: { ok: true } }; },
  });
}

async function remind(platform, body = { type: 'balance' }) {
  const sent = [];
  const res = fakeRes();
  await controllerFor(platform, sent).remindPaymentDeadline({ params: { id: '7' }, body }, res);
  return { res, sent };
}

test('rule 20 — relancer une réservation Airbnb est refusé, et aucun email ne part', async () => {
  const { res, sent } = await remind('airbnb');
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'PLATFORM_RESERVATION');
  assert.deepEqual(sent, [], 'rien n’a été envoyé');
});

// specs/platform-payout-due-date.md rule 2 — Lodgify est un canal PROPRE : le client nous doit son
// solde, la relance est légitime.
test('rule 20 — une réservation Lodgify se relance comme une directe', async () => {
  const { res, sent } = await remind('lodgify');
  assert.equal(res.statusCode, 200);
  assert.deepEqual(sent, [['balance', 7]]);
});

test('rule 20 — une réservation directe se relance, acompte comme solde', async () => {
  assert.deepEqual((await remind('direct', { type: 'deposit' })).sent, [['deposit', 7]]);
  assert.deepEqual((await remind('', { type: 'balance' })).sent, [['balance', 7]], 'plateforme vide = direct');
});

test('rule 20 — un type de relance inconnu est refusé avant tout envoi', async () => {
  const { res, sent } = await remind('direct', { type: 'caution' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'INVALID_TYPE');
  assert.deepEqual(sent, []);
});
