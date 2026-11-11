// specs/hosting-h2-account-security.md rule 68 (audit R22: R22-A1, R22-I3, R22-I4, R22-4, N4, R22-P2) — through the
// real application: a wrong JSON type on the authenticated API is a 4xx, never a 500 and never an `[unhandled]` line.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./inputShapeApp');
const { validatePropertyInput } = require('../utils/propertyValidation');

const T = JSON.parse('{"toString":1}');
let app;
let admin;
let reception;
let accountant;

test.before(async () => {
  app = await startApp();
  admin = await app.login('admin@shape.test');
  reception = await app.login('reception@shape.test');
  accountant = await app.login('accountant@shape.test');
  await app.activatePlugins(admin, ['hourly-resources', 'school-holidays', 'tariff-recipes', 'accounting-export', 'neat']);
});
test.after(async () => { if (app) await app.stop(); });

// Each row: who, method, path, body. The auditor's table (audit-r22-authz R22-A1), with the routes the plugin slice added.
const allT = (...keys) => Object.fromEntries(keys.map((k) => [k, T]));
const rows = () => {
  const { reservation, property, devis, client } = app.ids;
  const [{ id: cot }] = app.readDb("SELECT id FROM options WHERE autoOptionType = 'baby_bed'");
  return [
    ['any', 'POST', '/api/auth/change-password', { currentPassword: 'x', newPassword: T }],
    ['any', 'POST', '/api/auth/2fa/start', { method: 'totp', password: 'wrong', enrolmentToken: T }],
    ['any', 'POST', '/api/auth/2fa/confirm', { code: T }],
    ['any', 'PUT', '/api/users/me', allT('firstName', 'lastName', 'email', 'companyName', 'notes')],
    ['admin', 'POST', '/api/users', allT('firstName', 'lastName', 'email', 'companyName', 'notes')],
    ['admin', 'POST', '/api/users', { firstName: 'A', lastName: 'B', email: 'a@shape.test', roles: [T] }],
    ['admin', 'PUT', '/api/users/1', allT('firstName', 'lastName', 'companyName', 'notes')],
    ['reception', 'POST', '/api/planning/option-cards/done', allT('reservationId', 'optionId', 'date')],
    ['reception', 'POST', '/api/planning/option-cards/done', { reservationId: [T], optionId: [T], date: [T] }],
    ['reception', 'POST', '/api/planning/resource-cards/done', allT('reservationId', 'resourceId', 'date', 'start')],
    ['accountant', 'PUT', '/api/accounting/platform-accounts', allT('defaultAccount', 'vatRateCommission')],
    ['accountant', 'PUT', '/api/accounting/platform-accounts', allT('cancellationCompensationAccount')],
    ['accountant', 'PUT', '/api/accounting/platform-accounts', { defaultAccount: '622600', platforms: [null] }],
    ['admin', 'PATCH', `/api/reservations/${reservation}/payment`, allT('depositPaidDate', 'balancePaidDate', 'expectedAmountCents')],
    ['admin', 'PUT', `/api/reservations/${reservation}`, allT('platform', 'notes', 'discountPercent', 'customPrice', 'emailLanguage', 'breakfastTime', 'reservationNumber', 'propertyId', 'clientId')],
    ['admin', 'POST', '/api/reservations', allT('platform', 'notes', 'discountPercent', 'customPrice', 'propertyId', 'clientId', 'startDate', 'endDate')],
    ['admin', 'POST', '/api/reservations/calculate-price', allT('platform', 'discountPercent', 'customPrice', 'propertyId', 'reservationId', 'devisId')],
    ['admin', 'POST', '/api/reservations/platform-commission', allT('gross', 'payout', 'touristTax')],
    ['admin', 'POST', '/api/reservations/suggest-beds', allT('propertyId', 'adults', 'children')],
    ['admin', 'POST', `/api/reservations/${reservation}/cancel`, allT('reason', 'refund')],
    ['admin', 'POST', `/api/reservations/${reservation}/refunds`, allT('amount', 'date', 'reason')],
    ['admin', 'PUT', `/api/reservations/${reservation}/installments`, allT('installments', 'target')],
    ['admin', 'POST', '/api/clients', allT('firstName', 'lastName', 'email', 'phone')],
    ['admin', 'PUT', `/api/clients/${client}`, allT('firstName', 'notes', 'city')],
    ['admin', 'POST', '/api/devis', allT('platform', 'propertyId', 'clientId', 'startDate', 'endDate', 'checkInTime')],
    ['admin', 'PUT', `/api/devis/${devis}`, allT('platform', 'checkInTime', 'notes')],
    ['admin', 'PATCH', `/api/devis/${devis}/status`, { status: T }],
    ['admin', 'POST', '/api/establishment-closures', allT('propertyId', 'startDate', 'endDate', 'reason')],
    ['admin', 'POST', '/api/options', allT('title', 'description', 'price', 'priceType')],
    ['admin', 'POST', '/api/resources', allT('name', 'description', 'price')],
    ['admin', 'POST', '/api/properties', allT('name', 'depositPercent', 'defaultCheckIn')],
    ['admin', 'PUT', `/api/properties/${property}`, allT('name', 'photo', 'cleaningHours', 'touristTaxMode')],
    ['admin', 'PUT', `/api/properties/${property}/options`, { optionIds: T }],
    ['admin', 'PUT', `/api/properties/${property}/options`, { optionIds: 'x' }],
    ['admin', 'PUT', `/api/properties/${property}/options`, { optionIds: [999999] }],
    ['admin', 'PUT', `/api/properties/${property}/options`, { optionIds: [cot, cot] }],
    ['admin', 'PUT', `/api/properties/${property}/arrival-facts`, allT('accessCode', 'wifiPassword')],
    ['admin', 'POST', `/api/properties/${property}/pricing`, allT('startDate', 'endDate', 'pricePerNight')],
    ['admin', 'POST', `/api/properties/${property}/ical-sources`, allT('url', 'platformKey')],
    ['admin', 'PUT', '/api/platforms/1/color', { color: T }],
    ['admin', 'PUT', '/api/platforms/1/commission', allT('commissionPercent')],
    ['admin', 'PUT', '/api/platforms/1/deposit-mode', allT('mode', 'depositMode')],
    ['admin', 'PUT', '/api/platforms/1/payout-due-days', allT('days', 'payoutDueDays')],
    ['admin', 'PUT', '/api/onboarding/company', allT('name', 'email', 'phone', 'address', 'siret')],
    ['admin', 'PUT', '/api/onboarding/property', allT('name', 'maxGuests', 'doubleBeds', 'singleBeds', 'pricePerNight', 'checkIn', 'checkOut')],
    ['admin', 'PUT', '/api/terms/public-site-origin', { publicSiteOrigin: T }],
    ['admin', 'POST', '/api/emails/preview', allT('templateId', 'reservationId')],
    ['admin', 'POST', '/api/emails/send', allT('templateId', 'reservationId', 'subject', 'body')],
    ['admin', 'POST', '/api/email-templates', allT('name', 'subject', 'body')],
    ['admin', 'POST', '/api/translations/import', allT('csv', 'content')],
    ['admin', 'POST', '/api/school-holidays', { label: T }],
    ['admin', 'POST', `/api/properties/${property}/tariff-recipe/apply`, { recipeId: T }],
    ['admin', 'POST', '/api/tariff-recipes/journal', allT('propertyId', 'kind')],
    ['admin', 'PUT', '/api/neat/settings', allT('environment', 'clientId', 'clientSecret', 'marginPercent')],
    ['admin', 'POST', '/api/support-access/page', { path: T }],
  ];
};

test('rule 68 — every row of the audit answers a 4xx, with no [unhandled] line', async () => {
  const sessions = { admin, reception, accountant, any: admin };
  const failures = [];
  for (const [who, method, url, body] of rows()) {
    const mark = app.logMark();
    const res = await app.call(sessions[who], method, url, body);
    const unhandled = /\[unhandled\]/.test(app.logSince(mark));
    if (res.status >= 500 || unhandled) failures.push(`${who} ${method} ${url} ${JSON.stringify(body)} → ${res.status}${unhandled ? ' [unhandled]' : ''} ${res.text.slice(0, 120)}`);
  }
  assert.deepEqual(failures, []);
});

test('rule 68 — the net answers INVALID_FIELD_TYPE where no route refused first', async () => {
  const res = await app.call(admin, 'POST', '/api/reservations/platform-commission', allT('gross', 'payout', 'touristTax'));
  assert.equal(res.status, 400);
  assert.equal(res.json.code, 'INVALID_FIELD_TYPE');
  assert.equal(res.json.error, 'Requête invalide.');
});

test('rule 68 — the net leaves every pinned refusal in place', async () => {
  const { reservation } = app.ids;
  const flag = await app.call(admin, 'PATCH', `/api/reservations/${reservation}/payment`, { depositPaid: T });
  assert.equal(flag.status, 400);
  assert.equal(flag.json.code, 'INVALID_PAYMENT_FLAG');
  const lines = await app.call(admin, 'POST', '/api/reservations/calculate-price', { options: 'x' });
  assert.equal(lines.status, 400);
  assert.equal(lines.json.code, 'INVALID_LINES');
  const login = await app.call('', 'POST', '/api/auth/login', { email: T, password: 'x' });
  assert.equal(login.status, 400);
  assert.equal(login.json.error, 'MISSING_CREDENTIALS');
});

test('rule 68 — the assistant\'s company fields answer their own 422, not the net', async () => {
  for (const phone of [{}, T, [], 1, true]) {
    const res = await app.call(admin, 'PUT', '/api/onboarding/company', { name: 'Ombre', email: 'bonjour@shape.test', phone });
    assert.equal(res.status, 422, JSON.stringify(phone));
    assert.equal(res.json.errors.phone, 'Texte attendu.', JSON.stringify(phone));
  }
});

test('rule 68 — a property time is HH:MM, the one it already stores exempt', () => {
  const stored = { name: 'Ombre', maxGuests: 2, defaultCheckIn: '25:99', defaultCheckOut: '10:00' };
  const body = { name: 'Ombre', maxGuests: 2, defaultCheckOut: '10:00' };
  assert.equal(validatePropertyInput({ ...body, defaultCheckIn: '25:99' }, stored).defaultCheckIn, undefined);
  assert.equal(validatePropertyInput({ ...body, defaultCheckIn: '26:00' }, stored).defaultCheckIn, 'Heure invalide.');
  assert.equal(validatePropertyInput({ ...body, defaultCheckIn: '25:99' }, null).defaultCheckIn, 'Heure invalide.');
});

test('express-5-upgrade rule 10 — a season on a property that does not exist is a 404, with no [unhandled] line', async () => {
  const body = { label: 'Haute', pricePerNight: 100, startDate: app.dates.freeStart, endDate: app.dates.freeEnd };
  for (const id of ['999999', 'abc', '1.5', '1e999']) {
    const mark = app.logMark();
    const res = await app.call(admin, 'POST', `/api/properties/${id}/pricing`, body);
    assert.equal(res.status, 404, `${id} → ${res.status} ${res.text.slice(0, 120)}`);
    assert.equal(res.json.error, 'Logement introuvable.');
    assert.doesNotMatch(app.logSince(mark), /\[unhandled\]/, id);
  }
  const good = await app.call(admin, 'POST', `/api/properties/${app.ids.property}/pricing`, body);
  assert.equal(good.status, 200, good.text.slice(0, 200));
  const rows = app.readDb('SELECT DISTINCT propertyId FROM pricing_rules');
  assert.deepEqual(rows, [{ propertyId: app.ids.property }]);
});

test('R22-I3 — the e-mail preference page answers « lien inconnu » to a token that is not a string', async () => {
  for (const t of [T, [T], 12, true]) {
    const mark = app.logMark();
    const res = await app.call('', 'POST', '/preferences/emails', { t });
    assert.equal(res.status, 200, JSON.stringify(t));
    assert.doesNotMatch(app.logSince(mark), /\[unhandled\]/);
  }
  const twice = await app.call('', 'GET', '/preferences/emails?t=a&t=b');
  assert.equal(twice.status, 200);
});

test('R22-I4 (c) — a repeated query key is read as not sent', async () => {
  for (const url of [
    '/api/reservations?from=a&from=b', '/api/reservations?to=a&to=b', '/api/reservations?propertyId=1&propertyId=2', '/api/reservations?clientId=1&clientId=2',
    '/api/devis?from=a&from=b', '/api/devis?to=a&to=b', '/api/devis?propertyId=1&propertyId=2', '/api/devis?status=a&status=b',
    '/api/emails/history?limit=1&limit=2', '/api/emails/history?offset=1&offset=2', '/api/emails/history?reservationId=1&reservationId=2',
  ]) {
    const res = await app.call(admin, 'GET', url);
    assert.equal(res.status, 200, url);
  }
  const slots = await app.call(admin, 'GET', '/api/resources/1/free-slots?reservationId=a&reservationId=b');
  assert.ok(slots.status < 500, `free-slots ${slots.status}`);
});

test('R22-I4 (d) — an object is never stored as « [object Object] »', async () => {
  const { client, property } = app.ids;
  for (const [method, url, body] of [
    ['PUT', `/api/clients/${client}`, { firstName: 'Marie', lastName: {}, email: 'marie@shape.test', phone: '0600000000' }],
    ['PUT', `/api/clients/${client}`, { firstName: 'Marie', lastName: 'Martin', city: [{}], email: 'marie@shape.test', phone: '0600000000' }],
    ['POST', '/api/clients', { firstName: {}, lastName: 'Martin', email: 'autre@shape.test', phone: '0611111111' }],
    ['POST', '/api/options', { title: {}, price: 10, priceType: 'per_stay' }],
    ['POST', '/api/options', { title: 'Vin', description: [{}], price: 10, priceType: 'per_stay' }],
    ['PUT', `/api/properties/${property}`, { name: {} }],
    ['PUT', `/api/properties/${property}`, { name: 'Ombre', depositPercent: true }],
    ['PUT', `/api/properties/${property}`, { name: 'Ombre', defaultCheckIn: true }],
    ['PUT', `/api/properties/${property}`, { name: 'Ombre', cleaningHours: {} }],
    ['PUT', `/api/properties/${property}`, { name: 'Ombre', touristTaxMode: [] }],
    ['PUT', `/api/properties/${property}`, { name: 'Ombre', photo: {} }],
  ]) {
    const res = await app.call(admin, method, url, body);
    assert.ok(res.status >= 400 && res.status < 500, `${method} ${url} ${JSON.stringify(body)} → ${res.status}`);
  }
  const junk = app.readDb(`SELECT 'c' FROM clients WHERE lastName LIKE '%object%' OR firstName LIKE '%object%' OR city LIKE '%object%'
    UNION ALL SELECT 'o' FROM options WHERE title LIKE '%object%' OR description LIKE '%object%'
    UNION ALL SELECT 'p' FROM properties WHERE name LIKE '%object%'`);
  assert.deepEqual(junk, []);
});
