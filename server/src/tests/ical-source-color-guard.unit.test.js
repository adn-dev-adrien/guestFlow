// specs/platforms-and-ical-rework.md rule 17 (audit R24-I5, 2026-11-05) — through the real application: a colour sent on an
// iCal source passes the platform colour check, a stored colour sent back exempt; refused, nothing is written.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { startApp } = require('./inputShapeApp');
const { CALENDAR_COLOR_MESSAGES } = require('../utils/colorContrast');

let app;
let admin;

test.before(async () => {
  app = await startApp();
  admin = await app.login('admin@shape.test');
});
test.after(async () => { if (app) await app.stop(); });

const sources = () => app.readDb('SELECT id, platformKey, platformColor FROM ical_sources ORDER BY id');
const url = () => `/api/properties/${app.ids.property}/ical-sources`;

test('rule 17 — a colour that is not a readable #rrggbb is refused on create and update, nothing written', async () => {
  const before = sources();
  for (const platformColor of ['red;}body{display:none}', 'red', '#12345', '#ffffff', 'url(x)', '#112233; color: red']) {
    const res = await app.call(admin, 'POST', url(), { platformKey: 'probecolour', platformLabel: 'ProbeColour', platformColor });
    assert.equal(res.status, 400, `${platformColor}: ${res.text}`);
    assert.equal(res.json.code, 'INVALID_FIELD', platformColor);
    assert.equal(res.json.field, 'platformColor', platformColor);
    assert.ok(Object.values(CALENDAR_COLOR_MESSAGES).includes(res.json.error), res.json.error);
  }
  assert.deepEqual(sources(), before);
  const colours = await app.call(admin, 'GET', '/api/properties/platform-colors');
  assert.doesNotMatch(colours.text, /display:none/);

  const made = await app.call(admin, 'POST', url(), { platformKey: 'probecolour', platformLabel: 'ProbeColour', platformColor: '#1F4E79' });
  assert.equal(made.status, 200, made.text);
  const id = made.json.id;
  const refused = await app.call(admin, 'PUT', `${url()}/${id}`, { platformColor: 'red;}body{display:none}' });
  assert.equal(refused.status, 400, refused.text);
  assert.equal(refused.json.field, 'platformColor');
  assert.equal(app.readDb('SELECT platformColor FROM ical_sources WHERE id = ?', id)[0].platformColor, '#1F4E79');
});

test('rule 17 — a stored colour sent back passes, an empty or absent colour is no colour', async () => {
  const made = await app.call(admin, 'POST', url(), { platformKey: 'probelegacy', platformLabel: 'ProbeLegacy', platformColor: '#2F5D46' });
  assert.equal(made.status, 200, made.text);
  const id = made.json.id;
  const db = new Database(app.dbPath);
  try { db.prepare('UPDATE ical_sources SET platformColor = ? WHERE id = ?').run('legacy-text', id); } finally { db.close(); }
  const back = await app.call(admin, 'PUT', `${url()}/${id}`, { platformColor: 'legacy-text', url: '' });
  assert.equal(back.status, 200, back.text);
  for (const platformColor of ['', null, undefined]) {
    const res = await app.call(admin, 'PUT', `${url()}/${id}`, { platformColor, url: '' });
    assert.equal(res.status, 200, `${platformColor}: ${res.text}`);
  }
});
