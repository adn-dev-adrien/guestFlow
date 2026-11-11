// specs/control-plane-plans-and-access.md rule 48 (audit R22, console N3) — a free trial is granted by a real
// boolean only; same spec, rule 50 (N5) — a template key is an own key of the list, never one read through the
// prototype chain.

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeContext, NEW_CUSTOMER } = require('./helpers');

const TODAY = new Date().toISOString().slice(0, 10);
const CUSTOMER = { ...NEW_CUSTOMER, startsAt: TODAY };

test('rule 48 — trial: true or false, absent and null read as false, anything else is errors.trial and grants nothing', async () => {
  const h = makeContext({ at: `${TODAY}T10:00:00Z` });
  try {
    const { customers } = h.ctx.controllers;
    for (const trial of ['false', 'true', 'on', 1, 0, {}, [], JSON.parse('{"toString":1}')]) {
      const { errors } = customers.preview({ ...CUSTOMER, trial });
      assert.equal(errors.trial, 'Oui ou non attendu.', `trial = ${typeof trial}`);
      await assert.rejects(customers.create({ ...CUSTOMER, trial }, 'op'), (e) => e.status === 400 && e.body.errors.trial === 'Oui ou non attendu.');
    }
    assert.equal(h.ctx.models.customers.list().length, 0);
    for (const trial of [false, null, undefined]) {
      const p = customers.preview({ ...CUSTOMER, trial });
      assert.equal(p.errors.trial, undefined);
      assert.doesNotMatch(p.summary.period, /Essai gratuit/);
    }
    assert.match(customers.preview({ ...CUSTOMER, trial: true }).summary.period, /^Essai gratuit/);
    const c = await customers.create({ ...CUSTOMER, slug: 'sans-essai', trial: false }, 'op');
    assert.equal(c.trialEndsAt, null);
    const t = await customers.create({ ...CUSTOMER, slug: 'avec-essai', trial: true }, 'op');
    assert.ok(t.trialEndsAt > TODAY);
  } finally {
    h.cleanup();
  }
});

test('rule 50 — a key read off the prototype is an unknown template, on the preview and on the save', () => {
  const h = makeContext({ at: `${TODAY}T10:00:00Z` });
  try {
    const { templates } = h.ctx.controllers;
    const body = { subject: 'Sujet', body: 'Texte' };
    for (const key of ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf', 'inconnu']) {
      assert.throws(() => templates.preview(key, body), (e) => e.status === 404 && e.body.error === 'NOT_FOUND', key);
      assert.throws(() => templates.save(key, body, 'op'), (e) => e.status === 404 && e.body.error === 'NOT_FOUND', key);
    }
    const known = templates.list().templates[0].key;
    assert.equal(templates.preview(known, body).subject, 'Sujet');
  } finally {
    h.cleanup();
  }
});
