// specs/hosting-h2-account-security.md rule 68, reading of 2026-11-05 (R23 verification N1, N2, L5) — the routes the first
// baselines never reached: settings, e-mail texts, J-7 hooks, platform review wording refuse a wrong type, the stored value
// untouched; the fiche's draft client is cleaned like any client; a pasted tab separates words.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./inputShapeApp');
const { dayAt } = require('./inputShapeBaselines');

const T = JSON.parse('{"toString":1}');
const WRONG = [{ a: 1 }, T, ['ZZ'], 4242.25, true];
const SUBJECT = 'subject:reservation_confirmation';
let app;
let admin;

test.before(async () => {
  app = await startApp();
  admin = await app.login('admin@shape.test');
});
test.after(async () => { if (app) await app.stop(); });

const SETTINGS = [
  ['company', 'name', 'companyName'], ['company', 'address', 'companyAddress'], ['company', 'phone', 'companyPhone'],
  ['company', 'bankName', 'companyBankName'], ['company', 'portalCode', 'portalCode'],
  ['quote', 'footerText', 'quoteFooterText'], ['quote', 'footerTextEn', 'quoteFooterTextEn'],
  ['smtp', 'host', 'smtpHost'], ['smtp', 'username', 'smtpUsername'], ['smtp', 'fromName', 'smtpFromName'],
];

test('N1 — settings: a wrong type on a text column is SETTINGS_INVALID, the stored text stays', async () => {
  const good = { company: { name: 'Ombre', address: 'Rue', phone: '0102030405', bankName: 'Banque', portalCode: '1234' }, quote: { footerText: 'Pied', footerTextEn: 'Foot' }, smtp: { host: 'smtp.example.invalid', username: 'ombre', fromName: 'Ombre' } };
  assert.equal((await app.call(admin, 'PUT', '/api/settings', good)).status, 200);
  const stored = () => app.readDb('SELECT * FROM app_settings')[0];
  const before = stored();
  for (const [group, input, column] of SETTINGS) {
    for (const value of WRONG) {
      const res = await app.call(admin, 'PUT', '/api/settings', { [group]: { [input]: value } });
      assert.equal(res.status, 400, `${input} ${JSON.stringify(value)} → ${res.text}`);
      assert.equal(res.json.code, 'SETTINGS_INVALID');
      assert.equal(res.json.errors[column], 'Texte attendu.');
    }
    assert.equal(stored()[column], before[column], column);
  }
});

test('N1 — e-mail texts: 422 with key and field, nothing written; a null reads as not sent', async () => {
  const text = async () => (await app.call(admin, 'GET', '/api/email-texts')).json.sections.flatMap((s) => s.items).find((i) => i.key === SUBJECT);
  const before = await text();
  for (const lang of ['fr', 'en']) {
    for (const value of WRONG) {
      const res = await app.call(admin, 'PUT', '/api/email-texts', { changes: { [SUBJECT]: { [lang]: value } } });
      assert.equal(res.status, 422, res.text);
      assert.deepEqual(res.json, { key: SUBJECT, field: lang, message: 'Texte attendu.' });
    }
  }
  assert.equal((await app.call(admin, 'PUT', '/api/email-texts', { changes: { [SUBJECT]: { fr: null, en: null } } })).status, 200);
  const after = await text();
  assert.equal(after.fr, before.fr, 'no word « null »');
  assert.equal(after.en, before.en);
  assert.equal((await app.call(admin, 'PUT', '/api/email-texts', { changes: { [SUBJECT]: { fr: 'Votre séjour' } } })).status, 200);
  assert.equal((await text()).fr, 'Votre séjour');
});

test('N1 — J-7 hooks: 400, nothing written; a string and a null pass', async () => {
  const propertyId = app.ids.property;
  assert.equal((await app.call(admin, 'PUT', '/api/properties/email-hooks', { hooks: [{ propertyId, emailHook: 'Accroche' }] })).status, 200);
  for (const key of ['emailHook', 'emailHookEn']) {
    for (const value of WRONG) {
      const res = await app.call(admin, 'PUT', '/api/properties/email-hooks', { hooks: [{ propertyId, [key]: value }] });
      assert.equal(res.status, 400, `${key} ${res.text}`);
    }
  }
  const [row] = (await app.call(admin, 'GET', '/api/properties/email-hooks')).json.filter((h) => h.propertyId === propertyId);
  assert.equal(row.emailHook, 'Accroche');
  assert.equal((await app.call(admin, 'PUT', '/api/properties/email-hooks', { hooks: [{ propertyId, emailHookEn: null }] })).status, 200);
});

test('N1 — platform review wording: its errors entry, nothing written', async () => {
  await app.call(admin, 'POST', `/api/properties/${app.ids.property}/ical-sources`, { platformKey: 'canal', platformLabel: 'Canal' });
  const { id } = (await app.call(admin, 'GET', '/api/platforms/settings')).json.platforms.find((p) => !p.isDirect);
  assert.equal((await app.call(admin, 'PUT', '/api/platforms/settings', { platforms: [{ id, reviewWhereFr: 'sur le site', reviewWhereEn: 'on the site' }] })).status, 200);
  for (const key of ['reviewWhereFr', 'reviewWhereEn']) {
    for (const value of WRONG) {
      const res = await app.call(admin, 'PUT', '/api/platforms/settings', { platforms: [{ id, [key]: value }] });
      assert.equal(res.status, 400, res.text);
      assert.equal(res.json.errors[id][key], 'Texte attendu.');
    }
  }
  const after = (await app.call(admin, 'GET', '/api/platforms/settings')).json.platforms.find((p) => p.id === id);
  assert.equal(after.reviewWhereFr, 'sur le site');
  assert.equal(after.reviewWhereEn, 'on the site');
});

test('N2 — the fiche\'s draft client loses its control characters; a name of only those is no name', async () => {
  const stay = { propertyId: app.ids.property, startDate: dayAt(200), endDate: dayAt(202), adults: 2, platform: 'direct', checkInTime: '15:00', checkOutTime: '10:00' };
  const blank = await app.call(admin, 'POST', '/api/devis', { ...stay, newClient: { lastName: '\u0000', firstName: 'A' } });
  assert.equal(blank.status, 400, blank.text);
  const made = await app.call(admin, 'POST', '/api/devis', { ...stay, newClient: { lastName: 'Du\u0001rand', firstName: 'A\u0002' } });
  assert.equal(made.status, 201, made.text);
  const [client] = app.readDb('SELECT lastName, firstName FROM clients c JOIN reservations r ON r.clientId = c.id WHERE r.id = ?', made.json.id);
  assert.equal(client.lastName.toLowerCase(), 'durand');
  assert.equal(client.firstName.toLowerCase(), 'a');
});

test('L5 — a pasted tab becomes a space, in a name and in the notes', async () => {
  const made = await app.call(admin, 'POST', '/api/clients', { lastName: 'De\tla Tour', firstName: 'Lea', notes: 'Une\tnote', allowDuplicate: true });
  assert.equal(made.status, 200, made.text);
  const [row] = app.readDb('SELECT lastName, notes FROM clients WHERE id = ?', made.json.id);
  assert.equal(row.lastName.toLowerCase(), 'de la tour');
  assert.equal(row.notes, 'Une note');
});
