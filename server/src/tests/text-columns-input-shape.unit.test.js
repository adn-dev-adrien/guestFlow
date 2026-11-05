// specs/hosting-h2-account-security.md rule 68, reading of 2026-11-05 (audit R23-A3, R23-5, R23-I2, R23-I8) — on these routes
// a text field is a string, null or absent; the table is the auditor's. Only control characters leave the back office's
// text: D13 judges the public form alone.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./inputShapeApp');
const { KNOWN_PLATFORM_COLORS, isBuiltinColor } = require('../constants/platformColors');
const { validateApprovalCompensation } = require('../utils/cancellationCompensations');

const T = JSON.parse('{"toString":1}');
const WRONG = [{ a: 1 }, T, ['x'], [], true, 1.5, -1, 1e308];
const CONFIG = 'app_settings';
let app;
let admin;
const dirty = () => {
  const rows = [];
  for (const [table] of [[CONFIG], ['email_templates'], ['email_mentions'], ['options'], ['resources'], ['properties'], ['property_arrival_facts'], ['ical_sources'], ['platforms'], ['stay_texts'], ['cancellation_compensations']]) {
    const exists = app.readDb("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", table).length;
    if (!exists) continue;
    const columns = app.readDb(`PRAGMA table_info(${table})`).filter((c) => /TEXT/i.test(c.type)).map((c) => c.name);
    for (const column of columns) {
      for (const row of app.readDb(`SELECT "${column}" AS v FROM ${table} WHERE "${column}" LIKE '%[object%' OR "${column}" IN ('true', 'null', '1e+308', '1.5', '-1', '-1.0', 'Infinity', 'x')`)) rows.push(`${table}.${column}=${row.v}`);
    }
  }
  return rows;
};

test.before(async () => {
  app = await startApp();
  admin = await app.login('admin@shape.test');
  await app.activatePlugins(admin, ['hourly-resources']);
});
test.after(async () => { if (app) await app.stop(); });

test('rule 68 — no route of the auditor\'s table stores a wrong type as text', async () => {
  const { property } = app.ids;
  const option = (await app.call(admin, 'POST', '/api/options', { title: 'Panier', price: 1, priceType: 'per_stay' })).json.id;
  const resource = (await app.call(admin, 'POST', '/api/resources', { name: 'Velo', quantity: 1, price: 1, priceType: 'per_stay' })).json.id;
  const template = (await app.call(admin, 'POST', '/api/email-templates', { name: 'M', subject: 'S', body: 'B', dayOffset: 0, sendMode: 'manual' })).json.id;
  const mentionBody = { section: 'local', optionIds: [option], offerFr: 'Offre', offerEn: 'Offer', bookedFr: 'Pris', bookedEn: 'Booked' };
  const mention = (await app.call(admin, 'POST', '/api/email-mentions', mentionBody)).json.id;
  const compensationBody = { platform: 'Booking', expectedAmount: 1 };
  const compensation = (await app.call(admin, 'POST', '/api/accounting/cancellation-compensations', compensationBody)).json.compensation;
  const stayKey = (await app.call(admin, 'GET', '/api/stay-texts')).json.texts[0].key;
  const rows = [
    ['PUT', '/api/onboarding/emails', {}, ['phone', 'senderName']],
    ['POST', '/api/email-templates', { name: 'M', subject: 'S', body: 'B', dayOffset: 0, sendMode: 'manual' }, ['name', 'subject', 'body', 'subjectEn', 'bodyEn']],
    ['PUT', `/api/email-templates/${template}`, {}, ['name', 'subject', 'body', 'subjectEn', 'bodyEn']],
    ['POST', '/api/email-mentions', mentionBody, ['offerFr', 'offerEn', 'bookedFr', 'bookedEn']],
    ['PUT', `/api/email-mentions/${mention}`, mentionBody, ['offerFr', 'offerEn', 'bookedFr', 'bookedEn']],
    ['POST', '/api/accounting/cancellation-compensations', compensationBody, ['platform', 'propertyName', 'clientFirstName', 'clientLastName', 'notes']],
    ['PUT', `/api/accounting/cancellation-compensations/${compensation.id}`, compensationBody, ['platform', 'propertyName', 'clientFirstName', 'clientLastName', 'notes']],
    ['POST', '/api/options', { title: 'O', price: 1, priceType: 'per_stay' }, ['category', 'priceType', 'autoOptionType', 'autoPricingMode', 'autoFullNightThreshold']],
    ['PUT', `/api/options/${option}`, { title: 'O', price: 1, priceType: 'per_stay' }, ['category', 'priceType', 'autoOptionType', 'autoPricingMode', 'autoFullNightThreshold']],
    ['POST', '/api/resources', { name: 'R', quantity: 1, price: 1, priceType: 'per_stay' }, ['name', 'note', 'priceType', 'openTime', 'closeTime', 'openDays', 'hourlyEveningStart', 'emailBookedText', 'emailBookedTextEn']],
    ['PUT', `/api/resources/${resource}`, { name: 'R', quantity: 1, price: 1, priceType: 'per_stay' }, ['name', 'note', 'priceType', 'openTime', 'closeTime', 'openDays', 'hourlyEveningStart', 'emailBookedText', 'emailBookedTextEn']],
    ['PUT', `/api/stay-texts/${stayKey}`, { fr: 'Texte', en: 'Text' }, ['fr', 'en']],
    ['PUT', `/api/properties/${property}/arrival-facts`, {}, ['address', 'mapUrl', 'accessFr', 'accessEn', 'wifiName', 'accessCode', 'wifiPassword']],
    ['POST', `/api/properties/${property}/ical-sources`, { platformKey: 'pitchup', platformLabel: 'Pitchup' }, ['url', 'name', 'platformKey', 'platformLabel', 'platformColor']],
  ];
  const failures = [];
  for (const [method, url, baseline, keys] of rows) {
    const ok = await app.call(admin, method, url, baseline);
    if (ok.status >= 300) failures.push(`baseline ${method} ${url} → ${ok.status} ${ok.text.slice(0, 120)}`);
    for (const key of keys) {
      // An empty week is a resource closed every day: the editor can send it.
      for (const value of WRONG.filter((v) => !(key === 'openDays' && Array.isArray(v) && v.length === 0))) {
        const mark = app.logMark();
        const res = await app.call(admin, method, url, { ...baseline, [key]: value });
        const unhandled = /\[unhandled\]/.test(app.logSince(mark));
        if (res.status < 400 || res.status >= 500 || unhandled) failures.push(`${method} ${url} ${key}=${JSON.stringify(value)} → ${res.status}${unhandled ? ' [unhandled]' : ''}`);
      }
    }
  }
  assert.deepEqual(failures, []);
  assert.deepEqual(dirty(), []);
});

test('rule 68 — the assistant keeps phone and sender name on a null, and stores no word « null »', async () => {
  await app.call(admin, 'PUT', '/api/onboarding/emails', { phone: '0102030405', senderName: 'Ombre' });
  assert.equal((await app.call(admin, 'PUT', '/api/onboarding/emails', { phone: null, senderName: null })).status, 200);
  const [row] = app.readDb(`SELECT companyPhone, smtpFromName FROM ${CONFIG}`);
  assert.equal(row.companyPhone, '0102030405');
  assert.equal(row.smtpFromName, 'Ombre');
  for (const key of ['address', 'access', 'wifiName', 'accessCode', 'wifiPassword']) {
    const res = await app.call(admin, 'PUT', '/api/onboarding/emails', { properties: [{ id: app.ids.property, [key]: { a: 1 } }] });
    assert.equal(res.status, 422, key);
    assert.equal(res.json.errors[`properties.0.${key}`], 'Texte attendu.');
  }
});

test('rule 68 — an iCal source names the refused field, flags read as a tick does, the client\'s form passes', async () => {
  const url = `/api/properties/${app.ids.property}/ical-sources`;
  const good = { platformKey: 'greengo', platformLabel: 'GreenGo', url: '', disabled: false, feedMarksStaysClosed: true };
  const made = await app.call(admin, 'POST', url, good);
  assert.equal(made.status, 200, made.text);
  const res = await app.call(admin, 'POST', url, { platformLabel: {} });
  assert.equal(res.status, 400);
  assert.equal(res.json.code, 'INVALID_FIELD');
  assert.equal(res.json.field, 'platformLabel');
  for (const key of ['disabled', 'feedMarksStaysClosed', 'isActive', 'collectsTouristTax', 'touristTaxRemittedByPlatform']) {
    for (const value of ['false', 'x', {}, [], 2, null]) {
      const refused = await app.call(admin, 'PUT', `${url}/${made.json.id}`, { ...good, [key]: value });
      assert.equal(refused.status, 400, `${key} ${JSON.stringify(value)}`);
      assert.equal(refused.json.field, key);
    }
    for (const value of [true, false, 1, 0]) assert.equal((await app.call(admin, 'PUT', `${url}/${made.json.id}`, { ...good, [key]: value })).status, 200, `${key} ${value}`);
  }
  assert.equal((await app.call(admin, 'PUT', `${url}/${made.json.id}`, { ...good, touristTaxCollection: {} })).json.field, 'touristTaxCollection');
  assert.equal((await app.call(admin, 'PUT', `${url}/${made.json.id}`, { url: null, platformKey: null, platformLabel: null, platformColor: null })).status, 200, 'null keeps the stored one');
});

test('R23-I2 — a platform named « constructor » is a platform like any other', async () => {
  const url = `/api/properties/${app.ids.property}/ical-sources`;
  for (const body of [{ platformKey: 'constructor' }, { platformKey: 'CONSTRUCTOR' }, { platformLabel: 'Con-structor' }, { platformKey: 'x', platformLabel: 'constructor', url: '' }, { platformKey: '__proto__' }, { platformKey: 'toString' }, { platformKey: 'hasOwnProperty' }]) {
    const mark = app.logMark();
    const res = await app.call(admin, 'POST', url, body);
    assert.ok(res.status < 500, `${JSON.stringify(body)} → ${res.status} ${res.text.slice(0, 200)}`);
    assert.doesNotMatch(app.logSince(mark), /\[unhandled\]/);
  }
  const platforms = (await app.call(admin, 'GET', `/api/properties/${app.ids.property}/platforms`)).json.platforms;
  const row = platforms.find((p) => /^constructor$/i.test(p.name || p.platformLabel || ''));
  assert.ok(row, 'listed');
  assert.equal(row.isBuiltIn, false);
  assert.equal(KNOWN_PLATFORM_COLORS.constructor, undefined);
  assert.equal(isBuiltinColor('constructor', '#123456'), false);
  assert.deepEqual(Object.keys(KNOWN_PLATFORM_COLORS).includes('booking'), true);
  assert.equal(JSON.parse(JSON.stringify(KNOWN_PLATFORM_COLORS)).booking, KNOWN_PLATFORM_COLORS.booking);
});

test('R23-I8 — control characters leave a client, an option and a property; a name of only those is no name', async () => {
  const client = await app.call(admin, 'POST', '/api/clients', { lastName: 'Du\u0000ra\u0007nd', firstName: 'L\u001bea', city: 'Pa\u0000ris', street: 'Ru\u0000e', address: 'Ad\u0000r', notes: 'Une\nnote\u0000', allowDuplicate: true });
  assert.equal(client.status, 200, client.text);
  const [c] = app.readDb('SELECT lastName, firstName, city, street, address, notes FROM clients WHERE id = ?', client.json.id);
  assert.equal(c.lastName.toLowerCase(), 'durand');
  assert.equal(c.firstName.toLowerCase(), 'lea');
  assert.equal(c.city.toLowerCase(), 'paris');
  assert.equal(c.notes, 'Une\nnote', 'a line stays in the notes');

  const blank = await app.call(admin, 'POST', '/api/options', { title: '\u0000\u0001', price: 1, priceType: 'per_stay' });
  assert.equal(blank.status, 422);
  assert.equal(blank.json.details[0].field, 'title');
  const option = await app.call(admin, 'POST', '/api/options', { title: 'Pa\u0000nier', description: 'une\nligne\u0000', price: 1, priceType: 'per_stay' });
  const [o] = app.readDb('SELECT title, description FROM options WHERE id = ?', option.json.id);
  assert.equal(o.title, 'Panier');
  assert.equal(o.description, 'Une\nligne');

  const noName = await app.call(admin, 'POST', '/api/properties', { name: '\u0000', maxGuests: 2, doubleBeds: 1 });
  assert.equal(noName.status, 400);
  assert.equal(noName.json.errors.name, 'Le nom est obligatoire.');
  const named = await app.call(admin, 'POST', '/api/properties', { name: 'Ca\u0000bane\n', maxGuests: 2, doubleBeds: 1 });
  assert.equal(app.readDb('SELECT name FROM properties WHERE id = ?', named.json.id)[0].name, 'Cabane');
});

test('R23-I8 — D13 is unchanged: no character but control ones leaves the back office', async () => {
  const name = "Ñandú-O'Brien 李 2.";
  const client = await app.call(admin, 'POST', '/api/clients', { lastName: name, firstName: '', notes: 'Note <b>&</b>', allowDuplicate: true });
  const [c] = app.readDb('SELECT lastName, notes FROM clients WHERE id = ?', client.json.id);
  assert.match(c.lastName, /李 2\.$/);
  assert.equal(c.notes, 'Note <b>&</b>');
});

test('R23-I8 — a stored value sent back unchanged is not rewritten', async () => {
  const made = await app.call(admin, 'POST', '/api/clients', { lastName: 'Bon', firstName: 'Lea', allowDuplicate: true });
  const { id } = made.json;
  const Database = require('better-sqlite3');
  const raw = new Database(app.dbPath);
  raw.prepare("UPDATE clients SET notes = 'An\told' || char(1) WHERE id = ?").run(id);
  raw.close();
  const row = (await app.call(admin, 'GET', `/api/clients/${id}`)).json;
  assert.equal((await app.call(admin, 'PUT', `/api/clients/${id}`, row)).status, 200);
  assert.equal(app.readDb('SELECT notes FROM clients WHERE id = ?', id)[0].notes, row.notes);
});

test('rule 68 — the fix lines no test had pinned, one row each (R23 verification N3)', async (t) => {
  const { property } = app.ids;
  await t.test('client update cleans', async () => {
    const { id } = (await app.call(admin, 'POST', '/api/clients', { lastName: 'Clair', firstName: 'Lea', allowDuplicate: true })).json;
    assert.equal((await app.call(admin, 'PUT', `/api/clients/${id}`, { lastName: 'Cl\u0000air', firstName: 'Lea', city: 'Pa\u0001ris', allowDuplicate: true })).status, 200);
    assert.equal(app.readDb('SELECT city FROM clients WHERE id = ?', id)[0].city.toLowerCase(), 'paris');
  });
  await t.test('property update cleans', async () => {
    const { id } = (await app.call(admin, 'POST', '/api/properties', { name: 'Clair', maxGuests: 2, doubleBeds: 1 })).json;
    const row = (await app.call(admin, 'GET', `/api/properties/${id}`)).json;
    const saved = await app.call(admin, 'PUT', `/api/properties/${id}`, { ...row, name: 'Cl\u0000air' });
    assert.equal(saved.status, 200, saved.text);
    assert.equal(app.readDb('SELECT name FROM properties WHERE id = ?', id)[0].name, 'Clair');
  });
  await t.test('assistant property name cleans', async () => {
    const blank = await startApp();
    const Database = require('better-sqlite3');
    const raw = new Database(blank.dbPath);
    raw.exec('DELETE FROM reservations; DELETE FROM properties;');
    raw.close();
    const cookie = await blank.login('admin@shape.test');
    const made = await blank.call(cookie, 'PUT', '/api/onboarding/property', { name: 'As\u0000sistant', doubleBeds: 1, singleBeds: 0, pricePerNight: 80 });
    const names = blank.readDb('SELECT name FROM properties').map((row) => row.name);
    await blank.stop();
    assert.ok(made.status < 300, made.text);
    assert.deepEqual(names, ['Assistant']);
  });
  await t.test('assistant caution type', async () => {
    const res = await app.call(admin, 'PUT', '/api/onboarding/emails', { properties: [{ id: property, caution: { a: 1 } }] });
    assert.equal(res.status, 422);
    assert.equal(res.json.errors['properties.0.caution'], 'Un montant ≥ 0 €');
  });
  await t.test('assistant property id', async () => {
    for (const id of [true, [property], 1.5]) {
      const res = await app.call(admin, 'PUT', '/api/onboarding/emails', { properties: [{ id }] });
      assert.equal(res.status, 422, JSON.stringify(id));
      assert.equal(res.json.errors['properties.0'], 'Logement inconnu');
    }
  });
  await t.test('stay text property id', async () => {
    const { key } = (await app.call(admin, 'GET', '/api/stay-texts')).json.texts[0];
    const res = await app.call(admin, 'PUT', `/api/stay-texts/${key}`, { fr: 'Texte', propertyId: { a: 1 } });
    assert.equal(res.status, 400, res.text);
    assert.equal(res.json.field, 'propertyId');
  });
  await t.test('compensation property id', async () => {
    const res = await app.call(admin, 'POST', '/api/accounting/cancellation-compensations', { platform: 'Booking', expectedAmount: 10, propertyId: { a: 1 } });
    assert.equal(res.status, 400, res.text);
    assert.equal(res.json.field, 'propertyId');
  });
  await t.test('approval compensation notes', () => {
    assert.deepEqual(validateApprovalCompensation({ expectedAmount: 10, notes: { a: 1 } }), { ok: false, error: 'INVALID_FIELD', field: 'notes' });
    assert.equal(validateApprovalCompensation({ expectedAmount: 10, notes: ' Note ' }).value.notes, 'Note');
  });
});
