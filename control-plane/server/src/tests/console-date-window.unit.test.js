// specs/control-plane-plans-and-access.md rule 47 — every licence date the operator enters in the console lies in
// [today − 5 years, today + 5 years], the Paris day, as GuestFlow's dates do (specs/reservations-backend-mvc.md
// rule 13, second reading): the start and the custom end of a new subscription, an extension, « forcer actif
// jusqu’au ». Review of PR #938, F10: « Prolonger » to 9999-12-31 extended a licence forever.

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeContext, NEW_CUSTOMER } = require('./helpers');
const { addDays, addMonths, inWindow, windowError, PAST_WINDOW_MESSAGE, FUTURE_WINDOW_MESSAGE } = require('../utils/days');

// date-literal-ok: makeContext pins the console's clock on this instant; every date below is computed from it
const AT = '2026-09-29T10:00:00Z';
const TODAY = AT.slice(0, 10);
const FIRST = addMonths(TODAY, -60);
const LAST = addMonths(TODAY, 60);

test('rule 47 — the window runs from today − 5 years to today + 5 years, a 29 February landing on the 28th', () => {
  assert.equal(PAST_WINDOW_MESSAGE, 'Date trop ancienne : 5 ans au plus.');
  assert.equal(FUTURE_WINDOW_MESSAGE, 'Date trop lointaine : 5 ans au plus.');
  for (const day of [FIRST, TODAY, LAST]) assert.equal(inWindow(day, TODAY), true, day);
  assert.equal(inWindow(addDays(FIRST, -1), TODAY), false);
  assert.equal(inWindow(addDays(LAST, 1), TODAY), false);
  assert.equal(inWindow('9999-12-31', TODAY), false);
  assert.equal(windowError(addDays(FIRST, -1), TODAY), PAST_WINDOW_MESSAGE);
  assert.equal(windowError(addDays(LAST, 1), TODAY), FUTURE_WINDOW_MESSAGE);
  assert.equal(windowError(LAST, TODAY), null);
  const leap = `${Number(TODAY.slice(0, 4)) + ((4 - (Number(TODAY.slice(0, 4)) % 4)) % 4)}-02-29`;
  assert.equal(addMonths(leap, 60), `${Number(leap.slice(0, 4)) + 5}-02-28`);
});

test('rule 47 — a new subscription starts and ends inside the window', () => {
  const { ctx } = makeContext({ at: AT });
  const { customers } = ctx.controllers;
  assert.equal(customers.preview({ ...NEW_CUSTOMER, startsAt: addDays(FIRST, -1) }).errors.startsAt, PAST_WINDOW_MESSAGE);
  assert.equal(customers.preview({ ...NEW_CUSTOMER, startsAt: addDays(LAST, 1) }).errors.startsAt, FUTURE_WINDOW_MESSAGE);
  assert.equal(customers.preview({ ...NEW_CUSTOMER, startsAt: FIRST }).errors.startsAt, undefined);
  assert.equal(customers.preview({ ...NEW_CUSTOMER, length: 'custom', endsAt: '9999-12-31' }).errors.endsAt, FUTURE_WINDOW_MESSAGE);
  assert.equal(customers.preview({ ...NEW_CUSTOMER, length: 'custom', endsAt: LAST }).errors.endsAt, undefined);
});

test('rule 47 — « Prolonger » and « Forcer actif » are refused past the window, accepted on its last day', async () => {
  const { ctx } = makeContext({ at: AT });
  const { customers } = ctx.controllers;
  const c = await customers.create({ ...NEW_CUSTOMER, startsAt: TODAY }, 'op');
  const { endsAt } = c;
  const extend = (day) => customers.extend(c.id, { endsAt: day, reason: 'Geste commercial', expectedEndsAt: endsAt }, 'op');
  assert.throws(() => extend('9999-12-31'), (e) => e.status === 400 && e.body.message === FUTURE_WINDOW_MESSAGE);
  assert.throws(() => customers.forceActive(c.id, { until: addDays(LAST, 1), reason: 'Virement annoncé' }, 'op'), (e) => e.body.message === FUTURE_WINDOW_MESSAGE);
  assert.equal(ctx.models.audit.overrides(c.id).length, 0);
  customers.forceActive(c.id, { until: LAST, reason: 'Virement annoncé' }, 'op');
  extend(LAST);
  assert.equal(customers.view(c.id).endsAt, LAST);
});
