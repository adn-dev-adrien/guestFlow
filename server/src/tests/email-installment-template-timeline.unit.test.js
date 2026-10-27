// specs/guest-email-texts-made-simple.md rule 49 (adversarial review of the 2026-10-27 fixes) — the
// `installment_request` template had no entry in utils/emailTimeline.js nor utils/templateWhen.js:
// Emails › Modèles showed its long seed name, put it « Pendant le séjour » and read « Le jour de
// l'arrivée », editable. It is « Demande d’échéance », before the arrival with the payment emails,
// and leaves « à chaque échéance, à la demande » (not editable).
const test = require('node:test');
const assert = require('node:assert/strict');

const { displayNameOf, momentOf, timeline } = require('../utils/emailTimeline');
const { templateWhen } = require('../utils/templateWhen');
const { DEFAULT_TEMPLATES } = require('../utils/defaultEmailTemplatesRegistry');

const installment = DEFAULT_TEMPLATES.find((t) => t.stableKey === 'installment_request');

test('the installment request has its short name', () => {
  assert.ok(installment, 'shipped template');
  assert.equal(displayNameOf(installment), 'Demande d’échéance');
});

test('it sits before the arrival, first of that moment', () => {
  assert.equal(momentOf(installment).id, 'before');
  const before = timeline(DEFAULT_TEMPLATES).find((m) => m.id === 'before');
  assert.equal(before.templates[0].stableKey, 'installment_request');
});

test('its « Quand » is fixed: it leaves on each installment, on request', () => {
  const when = templateWhen(installment);
  assert.equal(when.label, 'À chaque échéance, à la demande');
  assert.equal(when.editable, false);
});
