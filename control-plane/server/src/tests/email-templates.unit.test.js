// specs/control-plane-plans-and-access.md rule 33 — the five templates, their mode, the refusal of an
// unknown placeholder or an empty text, and the server's preview.

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeContext } = require('./helpers');
const { render, templateError } = require('../utils/templates');

test('rule 33 — five templates, the four scheduled ones shipped « Manuel », the click one without a mode', () => {
  const h = makeContext();
  try {
    const { templates, placeholders } = h.ctx.controllers.templates.list();
    assert.deepEqual(templates.map((t) => [t.key, t.sendMode]), [
      ['invoice', 'manual'], ['reminder_before', 'manual'], ['reminder_due', 'manual'], ['reminder_after', 'manual'], ['reminder_manual', null],
    ]);
    assert.equal(templates[4].modeLabel, 'Le clic vaut validation');
    assert.ok(placeholders.includes('payUrl'));
  } finally {
    h.cleanup();
  }
});

test('rule 33 — an unknown placeholder or an empty text is refused; the mode changes and is said', () => {
  const h = makeContext();
  const t = h.ctx.controllers.templates;
  try {
    assert.throws(() => t.save('invoice', { body: 'Bonjour {{prenom}}' }, 'op'), (err) => err.status === 400 && err.body.error === 'UNKNOWN_PLACEHOLDER' && /Variable inconnue : \{\{prenom\}\}/.test(err.body.message));
    assert.throws(() => t.save('invoice', { subject: '  ' }, 'op'), (err) => err.body.error === 'EMPTY');
    const saved = t.save('reminder_due', { subject: 'Échéance {{deadline}}', sendMode: 'auto' }, 'op');
    assert.equal(saved.template.modeLabel, 'Automatique');
    assert.equal(saved.notice, 'Modèle « Relance jour J » enregistré : il partira seul.');
    assert.equal(t.save('reminder_manual', { sendMode: 'auto' }, 'op').template.sendMode, null, 'the click one keeps no mode');
    assert.throws(() => t.save('invoice', { sendMode: 'sometimes' }, 'op'), { status: 400 });
  } finally {
    h.cleanup();
  }
});

test('rule 33 — the preview renders the sample, and reports the refusal while typing', () => {
  const h = makeContext();
  try {
    const ok = h.ctx.controllers.templates.preview('invoice', { subject: 'Facture {{invoiceNumber}}', body: 'Bonjour {{contactName}}' });
    assert.deepEqual(ok, { error: null, subject: 'Facture F-2026-0051', body: 'Bonjour Claire' });
    const ko = h.ctx.controllers.templates.preview('invoice', { subject: 'x', body: '{{ nope }}' });
    assert.match(ko.error, /^Variable inconnue : \{\{nope\}\}/);
    assert.equal(render('{{a}} {{b}}', { a: 1 }), '1 {{b}}');
    assert.equal(templateError('x', '{{ payUrl }}'), null);
  } finally {
    h.cleanup();
  }
});
