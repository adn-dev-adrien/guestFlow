// specs/control-plane-plans-and-access.md rule 18 — the operator's alerts on the console's home
// page: customers entering due, grace, read-only or suspended today, those already read-only or
// suspended, and the failed steps. (The daily email and the failed payments come with C2b.)

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeContext, NEW_CUSTOMER } = require('./helpers');

test('rule 18 — what changed today, what is still blocked, what failed', async () => {
  const { ctx, now } = makeContext();
  const { customers, alerts } = ctx.controllers;
  const a = await customers.create({ ...NEW_CUSTOMER, companyName: 'Aulnes', billing: 'monthly', length: 1, startsAt: '2026-09-05' }, 'op');
  const b = await customers.create({ ...NEW_CUSTOMER, slug: 'moulin', companyName: 'Moulin', billing: 'monthly', length: 1, startsAt: '2026-07-01' }, 'op');
  now.set('2026-10-05T10:00:00Z');
  customers.reissueAll('système');
  const list = alerts.list().alerts;
  assert.ok(list.some((x) => x.customerId === a.id && x.text === 'Aulnes passe aujourd’hui en « Grâce ».' && x.severity === 'warning'), JSON.stringify(list));
  assert.ok(list.some((x) => x.customerId === b.id && /Moulin est en « Suspendu » depuis le 29\/09\/2026/.test(x.text)));
  assert.ok(list.some((x) => x.customerId === a.id && /étape « Licence signée » en échec/.test(x.text)));
  now.set('2026-10-06T10:00:00Z');
  assert.ok(!alerts.list().alerts.some((x) => /passe aujourd’hui/.test(x.text)), 'yesterday’s transition is no longer news');
});
