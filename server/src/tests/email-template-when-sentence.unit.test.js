// specs/guest-email-texts-made-simple.md rule 39 (UI/UX review 2026-10-18, decision 11) — « Quand ? » is
// one sentence, « Envoyé 2 jours avant l'arrivée », read live by the server with the day it would leave.

const test = require('node:test');
const assert = require('node:assert/strict');

const { setup, call } = require('./emailTextsFixture');
const { seedReservation } = require('./guestEmailSequenceFixtures');
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

test('rule 39: a write carrying « when » stores the offset the server reads, never one the page sent', async () => {
  const { db } = setup();
  const model = emailTemplatesModel.buildModel(db);
  const controller = buildController(model, { read: () => ({}) });
  const own = model.insert({ name: 'Promo', subject: 'S', body: 'B', dayOffset: -3, sendMode: 'manual' });
  const saved = await call(controller.update, { params: { id: own.id }, body: { dayOffset: -3, when: { days: '12', direction: 'before' } } });
  assert.equal(saved.status, 200);
  assert.equal(model.findById(own.id).dayOffset, -12);
  const refused = await call(controller.update, { params: { id: own.id }, body: { when: { days: '120', direction: 'before' } } });
  assert.equal(refused.status, 422);
  assert.deepEqual(refused.body, { field: 'days', message: '90 jours au plus.' });
  const created = await call(controller.create, { body: { name: 'N', subject: 'S', body: 'B', sendMode: 'manual', when: { days: '', direction: 'same' } } });
  assert.equal(created.status, 201);
  assert.equal(created.body.dayOffset, 0);
});

test('rule 39: a moment the application fixes is refused, read and written alike', async () => {
  const { db, templateId } = setup();
  const controller = buildController(emailTemplatesModel.buildModel(db), { read: () => ({}) });
  const thanks = templateId('guest_thanks_j1');
  const read = await call(controller.when, { body: { templateId: thanks, days: '1', direction: 'after' } });
  assert.equal(read.status, 422);
  assert.equal(read.body.message, 'Moment fixé par l’application : il ne se règle pas ici.');
  const write = await call(controller.update, { params: { id: thanks }, body: { when: { days: '3', direction: 'after' } } });
  assert.equal(write.status, 422);
  const reminder = db.prepare("SELECT id FROM email_templates WHERE stableKey = 'balance_reminder'").get();
  if (reminder) {
    const due = await call(controller.when, { body: { templateId: reminder.id, days: '4', direction: 'after' } });
    assert.equal(due.body.sentence, 'Envoyé 4 jours après l’échéance du solde');
  }
});

test('rule 39: the example names a stay the offset still reaches, its year when it is not this one', async () => {
  const { db } = setup({ withStay: false });
  const iso = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  seedReservation(db, { startDate: iso(3), endDate: iso(5) });
  seedReservation(db, { startDate: iso(400), endDate: iso(402) });
  const controller = buildController(emailTemplatesModel.buildModel(db), { read: () => ({}) });
  const near = await call(controller.when, { body: { days: '2', direction: 'before' } });
  assert.match(near.body.example, /^Prochain séjour \(Le Gîte, /);
  assert.doesNotMatch(near.body.example, new RegExp(` ${new Date().getFullYear() + 1}\\b`));
  // Seven days before an arrival in three days is already past: the next stay it reaches is next year's.
  const far = await call(controller.when, { body: { days: '7', direction: 'before' } });
  assert.match(far.body.example, new RegExp(`envoyé le \\w+ \\d+(er)? \\S+ ${iso(393).slice(0, 4)}\\.$`));
});
