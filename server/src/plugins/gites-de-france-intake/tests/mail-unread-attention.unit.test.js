// specs/gites-de-france-mail-intake.md rule 32 (audit r4, external N1) — a pass that hit the mail cap says how many
// mails it left unread, in its result and on the home's attention line, in short impersonal French.
const test = require('node:test');
const assert = require('node:assert/strict');

const { setup } = require('./serviceFixtures');
const { summarize } = require('../attention');

test('rule 32: a pass that hit the cap reports the mails left in its result', async () => {
  const { service, calls } = setup({ capped: { notRead: 340, limit: 200 } });
  const result = await service.runPass();
  assert.equal(result.unread, 340);
  assert.equal(typeof calls.handlers.onCap, 'function');
});

test('rule 32: a pass under the cap reports nothing', async () => {
  const { service } = setup();
  assert.equal('unread' in await service.runPass(), false);
});

test('rule 32: the attention line says the mails not read, alone or with the mails to check', () => {
  assert.deepEqual(summarize({ items: [], unread: 340 }), { count: 340, title: 'Mails non lus : 340 (afflux).', detail: 'Plafond de lecture atteint', severity: 'todo' });
  assert.equal(summarize({ items: [{}], unread: 340 }).detail, '1 mail · 340 non lus (afflux)');
  assert.equal(summarize({ items: [], unread: 0 }), null);
  assert.equal(summarize({ items: [{}, {}] }).detail, '2 mails');
});
