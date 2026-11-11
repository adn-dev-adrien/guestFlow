// specs/email-automation.md rule 20 (audit r4, R4-1) — the renderer is linear on a long run of spaces,
// its output unchanged, and a template's subject and body are capped (300 / 20 000 characters) when
// written by the editor or by the texts CSV.

const test = require('node:test');
const assert = require('node:assert/strict');

const { renderTemplate } = require('../utils/emailTemplateRenderer');
const { setup, call } = require('./emailTextsFixture');
const emailTemplatesModel = require('../models/emailTemplatesModel');
const { buildController } = require('../controllers/emailTemplatesController');
const { buildController: buildTexts } = require('../controllers/emailTextsController');

test('rule 20: 250 000 spaces render in under 100 ms', () => {
  const body = `${' '.repeat(250000)}x`;
  const started = process.hrtime.bigint();
  const out = renderTemplate({ subject: 'a', body }, { vars: {} });
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  assert.equal(out.body, body);
  assert.ok(ms < 100, `rendered in ${ms.toFixed(0)} ms`);
});

test('rule 20: the leading spaces of a swallowed name token still go, and only those', () => {
  const r = (body, vars = {}) => renderTemplate({ subject: 's', body }, { vars }).body;
  assert.equal(r('Bonjour {{clientFirstName}}, ok'), 'Bonjour, ok');
  assert.equal(r('Bonjour \t {{ clientFirstName }}! ok'), 'Bonjour! ok');
  assert.equal(r('Bonjour {{clientFirstName}} ok'), 'Bonjour  ok');
  assert.equal(r('Bonjour {{clientFirstName}}, ok', { clientFirstName: 'Jo' }), 'Bonjour Jo, ok');
  assert.equal(r('a {{clientFirstName}}, b {{clientLastName}}. c'), 'a, b. c');
  assert.equal(r('x  {{other}}, y'), 'x  , y');
});

test('rule 20: the editor refuses a subject over 300 and a body over 20 000 characters', async () => {
  const { db } = setup();
  const controller = buildController(emailTemplatesModel.buildModel(db), { read: () => ({}) });
  const base = { name: 'Long', subject: 'S', body: 'B', dayOffset: -3, sendMode: 'manual' };
  const subject = await call(controller.create, { body: { ...base, subject: 'a'.repeat(301) } });
  assert.equal(subject.status, 422);
  assert.equal(subject.body.field, 'subject');
  assert.match(subject.body.message, /300 caractères au plus/);
  const body = await call(controller.create, { body: { ...base, body: 'a'.repeat(20001) } });
  assert.equal(body.status, 422);
  assert.equal(body.body.field, 'body');
  const ok = await call(controller.create, { body: { ...base, subject: 'a'.repeat(300), body: 'a'.repeat(20000) } });
  assert.equal(ok.status, 201);
  const upd = await call(controller.update, { params: { id: ok.body.id }, body: { bodyEn: 'a'.repeat(20001) } });
  assert.equal(upd.status, 422);
  assert.equal(upd.body.field, 'bodyEn');
});

test('rule 20: the texts file and the texts save refuse the same lengths', async () => {
  const { db } = setup();
  const ctrl = buildTexts({ database: db, translator: { isAvailable: () => false } });
  const exported = (await call(ctrl.exportCsv)).body;
  const key = exported.split('\r\n').map((l) => l.split(';')[1]).find((k) => /^subject:/.test(k));
  const csv = `${exported.split('\r\n')[0]}\r\nX;${key};d;${'a'.repeat(301)};;\r\n`;
  const res = await call(ctrl.importCsv, { body: csv, query: { confirm: 'true' } });
  assert.equal(res.body.applied, false);
  assert.equal(res.body.refused.length, 1);
  assert.match(res.body.refused[0].message, /300 caractères au plus/);
  const saved = await call(ctrl.save, { body: { changes: { [key]: { fr: 'a'.repeat(301) } } } });
  assert.equal(saved.status, 422);
});
