// specs/settings-input-guards.md rules 59-60 (audit R24-I2, R24-I3, 2026-11-05) — through the real application: a photo
// the image library cannot read is a 400 that names it, nothing stored; a long document name is shortened, never an
// error that shows the server's path; any upload failure other than the size answers a fixed message.
const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { startApp } = require('./inputShapeApp');
const { safeUploadName } = require('../utils/uploadSafety');

let app;
let admin;

test.before(async () => {
  app = await startApp();
  admin = await app.login('admin@shape.test');
});
test.after(async () => { if (app) await app.stop(); });

async function send(method, url, fields, file) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
  if (file) form.append(file.field, new Blob([file.bytes], { type: file.type }), file.name);
  const res = await fetch(app.base + url, { method, headers: { cookie: admin, origin: app.base }, body: form });
  const text = await res.text();
  return { status: res.status, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() };
}

const fields = { name: 'Photo', maxGuests: 4, doubleBeds: 2 };
const count = () => app.readDb('SELECT COUNT(*) AS n FROM properties')[0].n;

test('rule 59 — a photo the library cannot read is « Image illisible. », on create and update, nothing stored', async () => {
  const webp = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#2F5D46' } }).webp().toBuffer();
  const unreadable = [
    ['a.png', 'image/png', Buffer.from('plain text, no image')],
    ['a.jpg', 'image/jpeg', Buffer.from('plain text, no image')],
    ['a.png', 'image/png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ['a.png', 'image/png', Buffer.alloc(0)],
  ];
  const before = count();
  const photoBefore = app.readDb('SELECT photo FROM properties WHERE id = ?', app.ids.property)[0].photo;
  for (const [name, type, bytes] of unreadable) {
    const created = await send('POST', '/api/properties', fields, { field: 'photo', name, type, bytes });
    assert.equal(created.status, 400, `create ${name} ${bytes.length}: ${created.text}`);
    assert.equal(created.json.error, 'Image illisible.');
    const updated = await send('PUT', `/api/properties/${app.ids.property}`, { name: 'Ombre', maxGuests: 4, singleBeds: 2, doubleBeds: 1 }, { field: 'photo', name, type, bytes });
    assert.equal(updated.status, 400, `update ${name}: ${updated.text}`);
    assert.equal(updated.json.error, 'Image illisible.');
  }
  assert.equal(count(), before, 'no property created');
  assert.equal(app.readDb('SELECT photo FROM properties WHERE id = ?', app.ids.property)[0].photo, photoBefore);
  const good = await send('POST', '/api/properties', fields, { field: 'photo', name: 'a.webp', type: 'image/webp', bytes: webp });
  assert.equal(good.status, 200, good.text);
});

test('rule 60 — a name too long for the disk is shortened, kept with its extension', () => {
  const long = `${'a'.repeat(300)}.pdf`;
  const kept = safeUploadName(long);
  assert.ok(kept.length <= 220, `${kept.length}`);
  assert.ok(kept.endsWith('.pdf'));
  assert.equal(safeUploadName('contrat.pdf'), 'contrat.pdf');
  assert.equal(safeUploadName(`${'é'.repeat(250)}.docx`).endsWith('.docx'), true);
});

test('rule 60 — a long document name is stored, the answer never shows a path', async () => {
  const name = `${'n'.repeat(245)}.pdf`;
  const res = await send('POST', `/api/properties/${app.ids.property}/documents`, {}, { field: 'file', name, type: 'application/pdf', bytes: Buffer.from('%PDF-1.4\n%%EOF\n') });
  assert.equal(res.status, 200, res.text);
  assert.doesNotMatch(res.text, /ENAMETOOLONG|\/uploads|\/private|\/var\//);
  const refused = await send('POST', `/api/properties/${app.ids.property}/documents`, {}, { field: 'other', name: 'a.pdf', type: 'application/pdf', bytes: Buffer.from('%PDF-1.4\n') });
  assert.equal(refused.status, 400, refused.text);
  assert.equal(refused.json.error, 'Fichier non enregistré.');
  const wrongType = await send('POST', `/api/properties/${app.ids.property}/documents`, {}, { field: 'file', name: 'a.exe', type: 'application/octet-stream', bytes: Buffer.from('MZ') });
  assert.equal(wrongType.status, 400);
  assert.equal(wrongType.json.error, 'Type de fichier non autorisé.');
});
