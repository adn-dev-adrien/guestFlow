// specs/gites-de-france-mail-intake.md rule 30 (audit r3, external N5) — a mail that is not an intake, or that
// was too large to read, is remembered like any other, so the next pass skips it before downloading it; the pass
// hands the reader a `seen` predicate and a cap, and takes the mails one by one.
const test = require('node:test');
const assert = require('node:assert/strict');

const { setup } = require('./serviceFixtures');

const INVOICE = { messageId: '<invoice@gdf07>', receivedAt: '2026-10-14T16:00:00.000Z', subject: 'Votre facture', text: 'Facture de commission du mois' };
const HUGE = { messageId: '<huge@gdf07>', receivedAt: '2026-10-14T16:01:00.000Z', subject: 'Nouvelle réservation', text: '', skipped: 'tooLarge' };

test('rule 30: the pass gives the reader a seen predicate and a cap of 200 mails', async () => {
  const { service, calls } = setup();
  await service.runPass();
  assert.equal(calls.handlers.limit, 200);
  assert.equal(typeof calls.handlers.seen, 'function');
  assert.equal(calls.handlers.seen('<m1@gdf07>'), true, 'the mail just read is known');
  assert.equal(calls.handlers.seen('<other@gdf07>'), false);
});

test('rule 30: a mail of another kind is remembered as ignored, out of every list', async () => {
  const { service, intakes, calls } = setup({ mails: [INVOICE] });
  assert.deepEqual(await service.runPass(), { read: 1 });
  assert.equal(calls.handlers.seen(INVOICE.messageId), true);
  assert.deepEqual(intakes.listOpen(), []);
});

test('rule 30: a mail too large to read is remembered as ignored', async () => {
  const { service, intakes, calls, db } = setup({ mails: [HUGE] });
  await service.runPass();
  assert.equal(calls.handlers.seen(HUGE.messageId), true);
  assert.equal(db.prepare('SELECT status FROM gdf_intakes WHERE messageId = ?').get(HUGE.messageId).status, 'ignored');
  assert.deepEqual(intakes.listOpen(), []);
});

test('rule 30: a second pass downloads none of the mails the first one saw', async () => {
  const { service, calls } = setup({ mails: [INVOICE, HUGE] });
  await service.runPass();
  let delivered = 0;
  const h = calls.handlers;
  for (const m of [INVOICE, HUGE]) if (!h.seen(m.messageId)) delivered += 1;
  assert.equal(delivered, 0);
});
