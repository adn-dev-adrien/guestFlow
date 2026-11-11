// specs/settings.md rule 8 (audit R24-I1 and its observation, 2026-11-05) — through the real application: the logo is a PNG or
// a JPEG, judged on its name, its type and its first bytes; a refused file changes nothing; a new logo removes the
// company-logo files of the other extensions; the devis PDF is still served whatever the stored logo holds.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { startApp } = require('./inputShapeApp');

let app;
let admin;
let uploads;
const images = {};

test.before(async () => {
  app = await startApp();
  admin = await app.login('admin@shape.test');
  uploads = path.join(path.dirname(app.dbPath), 'uploads');
  const pixel = () => sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 40, g: 90, b: 70, alpha: 1 } } });
  images.png = await pixel().png().toBuffer();
  images.jpeg = await pixel().jpeg().toBuffer();
  images.webp = await pixel().webp().toBuffer();
  images.gif = await pixel().gif().toBuffer();
  // A PNG whose chunks are whole but whose pixels are noise: PDFKit's reader throws it outside any caller.
  const wide = await sharp({ create: { width: 200, height: 200, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 0.5 } } }).png({ compressionLevel: 0 }).toBuffer();
  images.garbled = Buffer.from(wide);
  const idat = wide.indexOf(Buffer.from('IDAT'));
  images.garbled.fill(0xaa, idat + 6, idat + 2000);
  // Audit R24 verification N1: a 40×40 RGBA PNG, a few IDAT bits flipped, chunk CRCs fixed. sharp decodes it; PDFKit's own
  // inflate of the alpha channel fails its zlib check outside any caller and the PDF request never answered.
  images.zlibBroken = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAYAAACM/rhtAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAYUlEQVRYhe2UoQ0AURTCSFBsx65/wVvgPE9U4ElTUOp3OVoXCAULQc89CyMpBD13LRx1IeiT0bpAKFgIeu5ZGEkh6Llr4agLQZ+M1gVCwULQc8/CSApBz10DR10Ieu7bXz7jQZ4bJZAtFwAAAABJRU5ErkJggg==', 'base64');
  const photo = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#2F5D46' } }).jpeg().toBuffer();
  images.jpegHalf = photo.subarray(0, photo.length >> 1);
});
test.after(async () => { if (app) await app.stop(); });

async function upload(name, type, bytes) {
  const form = new FormData();
  form.append('logo', new Blob([bytes], { type }), name);
  const res = await fetch(`${app.base}/api/settings/logo`, { method: 'POST', headers: { cookie: admin, origin: app.base }, body: form });
  const text = await res.text();
  return { status: res.status, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() };
}

const storedLogo = () => app.readDb('SELECT companyLogoPath FROM app_settings WHERE id = 1')[0].companyLogoPath;
const logoFiles = () => fs.readdirSync(uploads).filter((f) => f.startsWith('company-logo')).sort();
const pdfStatus = async () => (await fetch(`${app.base}/api/devis/${app.ids.devis}/pdf`, { headers: { cookie: admin }, signal: AbortSignal.timeout(20000) })).status;
const storeRaw = (file, bytes) => {
  fs.writeFileSync(path.join(uploads, file), bytes);
  const db = new (require('better-sqlite3'))(app.dbPath);
  try { db.prepare('UPDATE app_settings SET companyLogoPath = ? WHERE id = 1').run(`/uploads/${file}`); } finally { db.close(); }
};

test('rule 8 — PNG and JPEG pass, the devis PDF carries them', async () => {
  for (const [name, type, bytes] of [['logo.png', 'image/png', images.png], ['logo.jpg', 'image/jpeg', images.jpeg], ['logo.jpeg', 'image/jpeg', images.jpeg]]) {
    const res = await upload(name, type, bytes);
    assert.equal(res.status, 200, `${name}: ${res.text}`);
    assert.equal(await pdfStatus(), 200, name);
  }
});

test('rule 8 — WEBP, GIF and bytes that are not their name\'s format are refused, the stored logo kept', async () => {
  assert.equal((await upload('logo.png', 'image/png', images.png)).status, 200);
  const before = fs.readFileSync(path.join(uploads, 'company-logo.png'));
  const cases = [
    ['logo.webp', 'image/webp', images.webp],
    ['logo.gif', 'image/gif', images.gif],
    ['logo.png', 'image/png', Buffer.from('not an image at all')],
    ['logo.png', 'image/png', images.webp],
    ['logo.png', 'image/png', Buffer.alloc(0)],
    ['logo.png', 'image/png', images.garbled],
    ['logo.png', 'image/png', images.png.subarray(0, 40)],
    ['logo.jpg', 'image/jpeg', images.jpegHalf],
    ['logo.svg', 'image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')],
  ];
  for (const [name, type, bytes] of cases) {
    const res = await upload(name, type, bytes);
    assert.equal(res.status, 400, `${name} (${type}, ${bytes.length} bytes): ${res.text}`);
    assert.equal(res.json.error, 'Logo en PNG ou JPEG uniquement.', name);
    assert.equal(storedLogo(), '/uploads/company-logo.png', name);
    assert.deepEqual(fs.readFileSync(path.join(uploads, 'company-logo.png')), before, `${name} left the stored logo untouched`);
  }
  assert.deepEqual(logoFiles(), ['company-logo.png']);
  assert.equal(await pdfStatus(), 200);
});

test('rule 8 — a new logo removes the company-logo files of the other extensions', async () => {
  fs.writeFileSync(path.join(uploads, 'company-logo.webp'), images.webp);
  fs.writeFileSync(path.join(uploads, 'company-logo.gif'), images.gif);
  assert.equal((await upload('logo.jpg', 'image/jpeg', images.jpeg)).status, 200);
  assert.deepEqual(logoFiles(), ['company-logo.jpg']);
  assert.equal((await upload('logo.png', 'image/png', images.png)).status, 200);
  assert.deepEqual(logoFiles(), ['company-logo.png']);
  assert.equal(storedLogo(), '/uploads/company-logo.png');
});

test('rule 8 — a stored logo the PDF cannot read gives the PDF without it, and a log line', async () => {
  for (const [file, bytes] of [['company-logo.webp', images.webp], ['company-logo.gif', images.gif], ['company-logo.png', images.png.subarray(0, 40)], ['company-logo.png', Buffer.alloc(0)], ['company-logo.png', images.garbled], ['company-logo.jpg', images.jpegHalf]]) {
    fs.writeFileSync(path.join(uploads, file), bytes);
    const db = new (require('better-sqlite3'))(app.dbPath);
    try { db.prepare('UPDATE app_settings SET companyLogoPath = ? WHERE id = 1').run(`/uploads/${file}`); } finally { db.close(); }
    const mark = app.logMark();
    const res = await fetch(`${app.base}/api/devis/${app.ids.devis}/pdf`, { headers: { cookie: admin } });
    const body = Buffer.from(await res.arrayBuffer());
    assert.equal(res.status, 200, `${file} (${bytes.length} bytes)`);
    assert.equal(body.subarray(0, 5).toString('latin1'), '%PDF-', file);
    assert.match(app.logSince(mark), /\[devisPdf\] logo/, file);
  }
});

// Audit R24 verification N3 — the stored name follows the bytes, not the name the file came with.
test('rule 8 — a JPEG named .png is stored as company-logo.jpg, a PNG named .jpg as company-logo.png', async () => {
  assert.equal((await upload('logo.png', 'image/png', images.jpeg)).status, 200);
  assert.equal(storedLogo(), '/uploads/company-logo.jpg');
  assert.deepEqual(logoFiles(), ['company-logo.jpg']);
  assert.equal((await sharp(fs.readFileSync(path.join(uploads, 'company-logo.jpg'))).metadata()).format, 'jpeg');
  assert.equal((await upload('logo.jpg', 'image/jpeg', images.png)).status, 200);
  assert.equal(storedLogo(), '/uploads/company-logo.png');
  assert.deepEqual(logoFiles(), ['company-logo.png']);
  assert.equal(await pdfStatus(), 200);
});

// Audit R24 verification N1 — PDFKit reads only bytes the image library wrote: at upload, and for a logo already stored.
test('rule 8 — a PNG whose alpha stream fails its zlib check: uploaded, stored re-encoded, the PDF answers with it', async () => {
  const res = await upload('logo.png', 'image/png', images.zlibBroken);
  assert.equal(res.status, 200, res.text);
  const stored = fs.readFileSync(path.join(uploads, 'company-logo.png'));
  assert.notDeepEqual(stored, images.zlibBroken, 'the stored file is what sharp wrote');
  assert.equal(await pdfStatus(), 200);
});

test('rule 8 — the same PNG already stored as is: the PDF answers, logo re-encoded on the way', async () => {
  storeRaw('company-logo.png', images.zlibBroken);
  const mark = app.logMark();
  assert.equal(await pdfStatus(), 200);
  assert.doesNotMatch(app.logSince(mark), /UNCAUGHT|incorrect data check/);
});
