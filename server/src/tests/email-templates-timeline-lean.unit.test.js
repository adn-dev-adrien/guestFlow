// specs/inte-performance.md rule 11 — the timeline lists what Emails › Modèles shows and no template
// body; the editor reads the bodies from GET /:id. The plain list keeps its full rows for its other
// readers (history filter, send dialog).
const test = require('node:test');
const assert = require('node:assert/strict');

const { setup, call } = require('./emailTextsFixture');
const emailTemplatesModel = require('../models/emailTemplatesModel');
const { buildController } = require('../controllers/emailTemplatesController');

const TIMELINE_FIELDS = [
  'anchor', 'createdAt', 'dayOffset', 'displayName', 'enabled', 'hasEnglish', 'id', 'name', 'sendMode', 'shipped',
  'stableKey', 'subject', 'subjectEn', 'textsSection', 'updatedAt', 'when', 'whenLabel',
];

function controllerOf() {
  const { db } = setup();
  return buildController(emailTemplatesModel.buildModel(db), { read: () => ({}) });
}

const row = (extra) => ({
  id: 1, stableKey: 'arrival_reminder_1d', name: 'J-2', subject: 'S', subjectEn: 'Se', body: 'B'.repeat(900), bodyEn: 'E'.repeat(900),
  anchor: 'start', dayOffset: -2, sendMode: 'manual', enabled: 1, createdAt: 'x', updatedAt: 'x', ...extra,
});

test('rule 11: a timeline row carries only the listed fields, never a body, whatever the stored row holds', async () => {
  const model = { list: () => [row(), row({ id: 2, stableKey: 'arrival_reminder_7d', dayOffset: -7 })] };
  const controller = buildController(model, { read: () => ({}) });
  const view = await call(controller.list, { query: { view: 'timeline' } });
  const templates = view.body.groups.flatMap((g) => g.templates);
  assert.equal(templates.length, 2);
  for (const template of templates) {
    assert.deepEqual(Object.keys(template).sort(), TIMELINE_FIELDS, `template ${template.id}`);
  }
});

test('rule 11: hasEnglish is still computed from the English body before it is dropped', async () => {
  const model = { list: () => [row(), row({ id: 2, stableKey: 'arrival_reminder_7d', bodyEn: '', dayOffset: -7 })] };
  const controller = buildController(model, { read: () => ({}) });
  const view = await call(controller.list, { query: { view: 'timeline' } });
  const byId = Object.fromEntries(view.body.groups.flatMap((g) => g.templates).map((t) => [t.id, t.hasEnglish]));
  assert.deepEqual(byId, { 1: true, 2: false });
});

test('rule 11: the plain list and GET /:id keep the bodies', async () => {
  const controller = controllerOf();
  const list = await call(controller.list, { query: {} });
  assert.equal(typeof list.body[0].body, 'string');
  const one = await call(controller.getOne, { params: { id: list.body[0].id } });
  assert.equal(one.body.body, list.body[0].body);
});

test('rule 11: the timeline is lighter than the list it replaces', async () => {
  const controller = controllerOf();
  const full = JSON.stringify((await call(controller.list, { query: {} })).body);
  const lean = JSON.stringify((await call(controller.list, { query: { view: 'timeline' } })).body);
  assert.ok(lean.length < full.length * 0.6, `${lean.length} vs ${full.length}`);
});
