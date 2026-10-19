// specs/guest-email-texts-made-simple.md rule 39 (UI/UX review 2026-10-18, decision 11) — « Quand ? » is
// one sentence, « Envoyé 2 jours avant l'arrivée », read live by the server with the day it would leave.

const test = require('node:test');
const assert = require('node:assert/strict');

const { setup, call } = require('./emailTextsFixture');
const { templateWhen, describeWhen } = require('../utils/templateWhen');
const emailTemplatesModel = require('../models/emailTemplatesModel');
const { buildController } = require('../controllers/emailTemplatesController');

test('rule 39: the sentence and whether its number can change', () => {
  assert.deepEqual(
    (({ editable, sentence, days, direction }) => ({ editable, sentence, days, direction }))(templateWhen({ stableKey: null, dayOffset: -2, anchor: 'start' })),
    { editable: true, sentence: 'Envoyé 2 jours avant l’arrivée', days: 2, direction: 'before' },
  );
  assert.equal(templateWhen({ stableKey: null, dayOffset: 1 }).sentence, 'Envoyé 1 jour après l’arrivée');
  assert.equal(templateWhen({ stableKey: 'balance_reminder', anchor: 'balanceDueDate', dayOffset: 3 }).sentence, 'Envoyé 3 jours après l’échéance du solde');
  assert.equal(templateWhen({ stableKey: 'balance_reminder', anchor: 'balanceDueDate', dayOffset: 3 }).editable, true);
  // The sequence counts its own days; the event emails leave on an action.
  assert.equal(templateWhen({ stableKey: 'arrival_reminder_1d', anchor: 'start', dayOffset: -2 }).editable, false);
  assert.equal(templateWhen({ stableKey: 'deposit_request', dayOffset: 0 }).sentence, 'Envoyé à la demande');
  assert.equal(templateWhen({ stableKey: 'deposit_request', dayOffset: 0 }).editable, false);
});

test('rule 39: what is typed is refused in words, under the number', () => {
  assert.deepEqual(describeWhen({ days: '2', direction: 'before' }), { ok: true, offsetDays: -2, sentence: 'Envoyé 2 jours avant l’arrivée' });
  assert.deepEqual(describeWhen({ days: '', direction: 'same' }), { ok: true, offsetDays: 0, sentence: 'Envoyé le jour de l’arrivée' });
  assert.equal(describeWhen({ days: '120', direction: 'after' }).message, '90 jours au plus.');
  assert.equal(describeWhen({ days: '2,5', direction: 'after' }).message, 'Un nombre entier de jours, sans signe.');
  assert.equal(describeWhen({ days: '-3', direction: 'after' }).message, 'Un nombre entier de jours, sans signe.');
  assert.equal(describeWhen({ days: '0', direction: 'before' }).message, '0 jour : choisir « le jour même de ».');
  assert.equal(describeWhen({ days: '', direction: 'before' }).field, 'days');
});

test('rule 39: POST /when answers the offset, the sentence and the day for the next stay', async () => {
  const { db } = setup();
  const controller = buildController(emailTemplatesModel.buildModel(db), { read: () => ({}) });
  const ok = await call(controller.when, { body: { days: '2', direction: 'before' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.offsetDays, -2);
  assert.equal(ok.body.sentence, 'Envoyé 2 jours avant l’arrivée');
  assert.match(ok.body.example, /^Prochain séjour \(Le Gîte, \w+ \d+(er)? \S+ au \w+ \d+(er)? \S+\) : envoyé le \w+ \d+(er)? \S+\.$/);
  const refused = await call(controller.when, { body: { days: '120', direction: 'before' } });
  assert.equal(refused.status, 422);
  assert.deepEqual(refused.body, { field: 'days', message: '90 jours au plus.' });
});
