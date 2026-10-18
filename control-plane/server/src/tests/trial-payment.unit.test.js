// specs/control-plane-plans-and-access.md rule 35 — a payment received during the free trial ends
// the trial: the paid period starts that day, the state is active at once, the countdown runs to the
// paid end, and the licence the instance reads no longer says « essai ».

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeContext, licencePayload, NEW_CUSTOMER } = require('./helpers');

test('rule 35 — a payment recorded during the trial ends it and starts the paid period that day', async () => {
  const h = makeContext({ at: '2026-10-18T10:00:00Z' });
  try {
    const { customers } = h.ctx.controllers;
    const c = await customers.create({ ...NEW_CUSTOMER, trial: true, billing: 'monthly', length: 1, startsAt: '2026-10-17' }, 'op');
    const trial = customers.view(c.id);
    assert.equal(trial.state, 'trial');
    assert.equal(licencePayload(customers.licenceDownload(c.id).token).state, 'trial');
    assert.equal(trial.trialEndsAt, '2026-11-16');
    assert.match(trial.paymentPreview[0].text, /l’essai s’arrête : la période part d’aujourd’hui/);
    const v = customers.recordPayment(c.id, { months: 1, reference: 'virement', expectedEndsAt: trial.endsAt }, 'op');
    assert.equal(v.state, 'active');
    assert.equal(v.trialEndsAt, null);
    assert.equal(v.endsAt, '2026-11-18');
    assert.equal(v.daysLeft, 31);
    const licence = licencePayload(customers.licenceDownload(c.id).token);
    assert.notEqual(licence.state, 'trial');
    assert.equal(licence.trialEndsAt ?? null, null);
  } finally {
    h.cleanup();
  }
});

test('rule 35 — outside the trial a payment still adds to the current end date (rule 15)', async () => {
  const h = makeContext({ at: '2026-10-18T10:00:00Z' });
  try {
    const { customers } = h.ctx.controllers;
    const c = await customers.create({ ...NEW_CUSTOMER, billing: 'monthly', length: 1, startsAt: '2026-10-10' }, 'op');
    const v = customers.recordPayment(c.id, { months: 1, expectedEndsAt: c.endsAt }, 'op');
    assert.equal(v.endsAt, '2026-12-10');
    assert.equal(v.state, 'active');
  } finally {
    h.cleanup();
  }
});
