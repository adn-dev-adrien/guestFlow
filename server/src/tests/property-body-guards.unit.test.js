// specs/settings-input-guards.md rules 55-58 (audit R23-I1, R23-I3, R23-I4, section 4 of R23-A2) — through the real application: the first price
// of a new property, the tourist-tax mode and the photo of a JSON body.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Database = require('better-sqlite3');
const path = require('node:path');
const { startApp } = require('./inputShapeApp');
const { validatePropertyInput, seasonInputRefusal } = require('../utils/propertyValidation');

const T = JSON.parse('{"toString":1}');
const dayAt = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const base = { name: 'P', maxGuests: 4, doubleBeds: 2 };
let app;
let admin;

test.before(async () => {
  app = await startApp();
  admin = await app.login('admin@shape.test');
});
test.after(async () => { if (app) await app.stop(); });

test('rule 55 — a sent first price is a usable number ≥ 0, on creation only', async () => {
  for (const pricePerNight of ['1e999', '1e300', 1e300, -5, 'abc', '12,5', '  ', true, [1]]) {
    const res = await app.call(admin, 'POST', '/api/properties', { ...base, pricePerNight });
    assert.equal(res.status, 400, JSON.stringify(pricePerNight));
    assert.equal(res.json.error, 'PROPERTY_INVALID');
    assert.equal(res.json.errors.pricePerNight, 'Un montant ≥ 0 €.');
  }
  const huge = await app.call(admin, 'POST', '/api/properties', `{"name":"P","maxGuests":4,"doubleBeds":2,"pricePerNight":1e999}`);
  assert.equal(huge.status, 400, huge.text);
  assert.deepEqual(app.readDb("SELECT pricePerNight FROM pricing_rules WHERE pricePerNight > 1e15"), []);

  const sent = await app.call(admin, 'POST', '/api/properties', { ...base, pricePerNight: 80 });
  assert.equal(sent.status, 200, sent.text);
  assert.equal(app.readDb('SELECT pricePerNight FROM pricing_rules WHERE propertyId = ?', sent.json.id)[0].pricePerNight, 80);
  const text = await app.call(admin, 'POST', '/api/properties', { ...base, pricePerNight: '75.5' });
  assert.equal(app.readDb('SELECT pricePerNight FROM pricing_rules WHERE propertyId = ?', text.json.id)[0].pricePerNight, 75.5);
  const absent = await app.call(admin, 'POST', '/api/properties', { ...base });
  assert.equal(app.readDb('SELECT pricePerNight FROM pricing_rules WHERE propertyId = ?', absent.json.id)[0].pricePerNight, 100);
  const empty = await app.call(admin, 'POST', '/api/properties', { ...base, pricePerNight: '' });
  assert.equal(empty.status, 200, 'an empty field is not sent');
  assert.equal(validatePropertyInput({ ...base, pricePerNight: 1e300 }, { name: 'P', maxGuests: 4 }).pricePerNight, undefined, 'an update does not read this key');
});

test('rule 55 — the start assistant refuses the same price, and keeps its comma', async () => {
  const fresh = await startApp();
  try {
    const session = await fresh.login('admin@shape.test');
    const raw = new Database(fresh.dbPath);
    raw.exec('DELETE FROM reservations; DELETE FROM properties;');
    raw.close();
    const step = (pricePerNight) => fresh.call(session, 'PUT', '/api/onboarding/property', { name: 'Ombre', doubleBeds: 1, singleBeds: 0, pricePerNight, checkIn: '16:00', checkOut: '10:00' });
    for (const price of [1e300, '1e300', -5, 'abc']) {
      const res = await step(price);
      assert.equal(res.status, 422, String(price));
      assert.equal(res.json.errors.pricePerNight, 'Prix positif ou nul');
    }
    const done = await step('12,5');
    assert.equal(done.status, 200, done.text);
    assert.equal(fresh.readDb('SELECT pricePerNight FROM pricing_rules WHERE propertyId = ?', done.json.id)[0].pricePerNight, 12.5);
  } finally { await fresh.stop(); }
});

test('rule 56 — the tourist-tax mode is one of the three, a stored one sent back exempt', async () => {
  const stored = { name: 'P', maxGuests: 2, touristTaxMode: 'legacy_mode' };
  for (const mode of ['percentage', 'none', 'garbage', 'x'.repeat(300), 'constructor']) {
    const res = await app.call(admin, 'POST', '/api/properties', { ...base, touristTaxMode: mode });
    assert.equal(res.status, 400, mode);
    assert.equal(res.json.errors.touristTaxMode, 'Choix invalide.');
    const put = await app.call(admin, 'PUT', `/api/properties/${app.ids.property}`, { name: 'Ombre', touristTaxMode: mode });
    assert.equal(put.status, 400, mode);
  }
  assert.equal(validatePropertyInput({ name: 'P', touristTaxMode: 'legacy_mode' }, stored).touristTaxMode, undefined);
  assert.equal(validatePropertyInput({ name: 'P', touristTaxMode: 'garbage' }, stored).touristTaxMode, 'Choix invalide.');
  for (const mode of ['per_day_per_person', 'percentage_accommodation', 'percentage_and_fixed', '']) {
    assert.equal(validatePropertyInput({ name: 'P', touristTaxMode: mode }, null).touristTaxMode, undefined, mode);
  }
});

test('rule 57 — a photo in a body passes only as the stored value: a deletion cannot remove another file', async () => {
  const created = await app.call(admin, 'POST', '/api/properties', { ...base, name: 'Victime' });
  const uploads = path.join(path.dirname(app.dbPath), 'uploads');
  const victim = path.join(uploads, 'logo-victim.png');
  fs.writeFileSync(victim, 'x');
  for (const photo of ['/uploads/logo-victim.png', 'https://example.invalid/a.png', '../x']) {
    const res = await app.call(admin, 'PUT', `/api/properties/${created.json.id}`, { name: 'Victime', photo });
    assert.equal(res.status, 400, photo);
    assert.equal(res.json.error, 'PROPERTY_INVALID');
    assert.equal(res.json.errors.photo, 'Valeur invalide.');
  }
  assert.equal((await app.call(admin, 'POST', '/api/properties', { ...base, photo: '/uploads/logo-victim.png' })).status, 400);
  assert.equal(app.readDb('SELECT photo FROM properties WHERE id = ?', created.json.id)[0].photo, '');
  assert.equal((await app.call(admin, 'DELETE', `/api/properties/${created.json.id}`)).status, 200);
  assert.equal(fs.existsSync(victim), true);
  const stored = { name: 'P', maxGuests: 2, photo: '/uploads/a.png' };
  assert.equal(validatePropertyInput({ name: 'P', photo: '/uploads/a.png' }, stored).photo, undefined);
  assert.equal(validatePropertyInput({ name: 'P', photo: '' }, stored).photo, undefined);
});

test('rule 58 — a season: label and colour are text, the mode one of two, a stored one exempt', async () => {
  const body = { label: 'Haute', pricePerNight: 100, startDate: dayAt(900), endDate: dayAt(901) };
  const url = `/api/properties/${app.ids.property}/pricing`;
  for (const [field, values] of [['label', [{ a: 1 }, T, 1.5, true]], ['color', [{ a: 1 }, T, 1.5, true, []]], ['pricingMode', ['bogus', { a: 1 }, T, 1.5, true, []]]]) {
    for (const value of values) {
      const res = await app.call(admin, 'POST', url, { ...body, [field]: value });
      assert.equal(res.status, 400, `${field} ${JSON.stringify(value)} → ${res.text.slice(0, 120)}`);
      assert.equal(res.json.code, 'INVALID_SEASON');
      assert.equal(res.json.field, field);
    }
  }
  assert.equal(seasonInputRefusal({ pricingMode: 'legacy' }, { pricingMode: 'legacy' }), null);
  for (const pricingMode of ['fixed', 'progressive', '', null, undefined]) assert.equal(seasonInputRefusal({ pricingMode }), null, String(pricingMode));
});
