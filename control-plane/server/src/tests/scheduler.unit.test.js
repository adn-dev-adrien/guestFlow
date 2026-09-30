// specs/control-plane-plans-and-access.md rules 9 and 14 — the daily run at 04:00 Paris time
// recomputes every state and re-issues every licence once a day, catching up after downtime.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createScheduler } = require('../tasks/scheduler');
const { makeContext, NEW_CUSTOMER } = require('./helpers');

test('rules 9 and 14 — once a day, after 04:00 Paris time, catching up a missed day', async () => {
  const { ctx, now } = makeContext({ at: '2026-10-01T01:30:00Z' });
  const c = await ctx.controllers.customers.create({ ...NEW_CUSTOMER, billing: 'monthly', length: 1, startsAt: '2026-09-01' }, 'op');
  const sched = createScheduler(ctx, () => {});
  assert.equal(await sched.tick(), null, '03:30 in Paris: not yet');
  now.set('2026-10-01T02:05:00Z');
  const run = await sched.tick();
  assert.deepEqual(run, { day: '2026-10-01', refreshed: 1, erased: 0, invoiced: 0, notified: 0 });
  assert.equal(ctx.controllers.customers.view(c.id).state, 'grace');
  assert.equal(await sched.tick(), null, 'not twice the same day');
  now.set('2026-10-09T15:00:00Z');
  assert.equal((await sched.tick()).day, '2026-10-09');
  assert.equal(ctx.controllers.customers.view(c.id).state, 'read_only');
});
