// specs/settings-input-guards.md rule 63 (audit R42-DB-L1 / R42-INJ-L2, 2026-11-10) — through the real application: a
// document's `type` is contract / rules / other, its `name` one text of at most 200 characters. A repeated or bracketed
// field used to answer 500 (or store « A,b ») and leave the uploaded private file with no row pointing at it; a long
// name or type was stored whole. Every refusal is a 400 before the row, and the upload is removed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startApp } = require('./inputShapeApp');

let app;
let admin;
let privateDir;

test.before(async () => {
  app = await startApp();
  admin = await app.login('admin@shape.test');
  privateDir = path.join(path.dirname(app.dbPath), 'private-documents');
});
test.after(async () => { if (app) await app.stop(); });

const PDF = Buffer.from('%PDF-1.4\n%%EOF\n');
async function upload(pairs) {
  const form = new FormData();
  for (const [key, value] of pairs) form.append(key, value);
  form.append('file', new Blob([PDF], { type: 'application/pdf' }), 'contrat.pdf');
  const res = await fetch(`${app.base}/api/properties/${app.ids.property}/documents`, { method: 'POST', headers: { cookie: admin, origin: app.base }, body: form });
  const text = await res.text();
  return { status: res.status, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() };
}
const rows = () => app.readDb('SELECT COUNT(*) AS n FROM documents')[0].n;
const files = () => (fs.existsSync(privateDir) ? fs.readdirSync(privateDir).length : 0);

test('rule 63 — a repeated, bracketed, foreign or long field is 400, no row, no private file left', async () => {
  const refused = [
    [['type', 'other'], ['type', 'other'], ['name', 'Contrat']],
    [['type[x]', 'A'], ['name', 'Contrat']],
    [['type', 'contract'], ['name[x]', 'A']],
    [['type', 'contract'], ['name', 'A'], ['name', 'B']],
    [['type', 'invoice'], ['name', 'Contrat']],
    [['type', 'x'.repeat(100000)], ['name', 'Contrat']],
    [['type', 'contract'], ['name', 'n'.repeat(201)]],
  ];
  const rowsBefore = rows();
  const filesBefore = files();
  for (const pairs of refused) {
    const res = await upload(pairs);
    assert.equal(res.status, 400, `${JSON.stringify(pairs).slice(0, 120)}: ${res.text}`);
    assert.ok(res.json && typeof res.json.error === 'string', res.text);
  }
  assert.equal(rows(), rowsBefore, 'no row written');
  assert.equal(files(), filesBefore, 'no orphan private file');
});

test('rule 63 — the page\'s own upload still lands: one type of the list, a name of 200 characters, or none (the file\'s)', async () => {
  const rowsBefore = rows();
  for (const pairs of [[['type', 'rules'], ['name', 'Règlement intérieur']], [['type', 'other'], ['name', 'n'.repeat(200)]], [['type', 'contract']], []]) {
    const res = await upload(pairs);
    assert.equal(res.status, 200, `${JSON.stringify(pairs).slice(0, 80)}: ${res.text}`);
  }
  assert.equal(rows(), rowsBefore + 4);
  const names = app.readDb('SELECT type, name FROM documents ORDER BY id DESC LIMIT 4');
  assert.deepEqual(names.map((r) => r.type), ['other', 'contract', 'other', 'rules']);
  assert.equal(names[3].name, 'Règlement intérieur');
});
