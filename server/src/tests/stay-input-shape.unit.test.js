// specs/reservations-backend-mvc.md rule 16 (audit R22-4) — the shape of a stay's fields, on preview, create, update,
// devis create/update, suggest-beds and devis status. The numbers stay with utils/lineInputBounds.js (rule 15).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./inputShapeApp');
const { stayShapeRefusal } = require('../utils/stayInputShape');

const T = JSON.parse('{"toString":1}');
const BAD_TIMES = ['abc', '25:99', '24:00', '9:00', '15:00:00', true, [], {}, [1], -1, 1e308, 0.5, T];
let app;
let admin;
let stay;

test.before(async () => {
  app = await startApp();
  admin = await app.login('admin@shape.test');
  stay = () => ({
    propertyId: app.ids.property, clientId: app.ids.client, startDate: app.dates.start, endDate: app.dates.end,
    adults: 2, checkInTime: '15:00', checkOutTime: '10:00', platform: 'direct', notes: '', reservationNumber: '',
    depositDisabled: false, extraGuestSurchargeOffered: false,
  });
});
test.after(async () => { if (app) await app.stop(); });

test('rule 16 — the guard reads each shape', () => {
  assert.equal(stayShapeRefusal({}), null);
  assert.equal(stayShapeRefusal({ platform: null, notes: null, checkInTime: null, checkOutTime: '', depositDisabled: null, propertyId: null, clientId: '' }), null);
  assert.equal(stayShapeRefusal({ platform: 'Airbnb', notes: 'x', checkInTime: '00:00', checkOutTime: '23:59', propertyId: 1, clientId: '12', depositDisabled: 1, extraGuestSurchargeOffered: true }), null);
  for (const [field, value] of [
    ['platform', 123], ['platform', true], ['notes', {}], ['notes', []], ['emailLanguage', T], ['pdfLanguage', 1],
    ['reservationNumber', 5000], ['reservationNumber', 'x'.repeat(65)], ['propertyId', true], ['propertyId', 0.5], ['propertyId', 1e308], ['propertyId', -1], ['propertyId', 'abc'],
    ['clientId', -1], ['clientId', 'abc'], ['reservationId', T], ['devisId', 1.5],
    ['depositDisabled', 'false'], ['extraGuestSurchargeOffered', 'abc'], ['touristTaxInComplement', 'x'], ['refreshPricingToCurrent', 'true'],
  ]) {
    const refusal = stayShapeRefusal({ [field]: value });
    assert.equal(refusal && refusal.code, 'INVALID_FIELD', `${field} ${JSON.stringify(value)}`);
    assert.equal(refusal.field, field);
  }
  for (const field of ['checkInTime', 'checkOutTime', 'breakfastTime']) {
    for (const value of BAD_TIMES) {
      const refusal = stayShapeRefusal({ [field]: value });
      assert.equal(refusal && refusal.code, 'INVALID_TIME', `${field} ${JSON.stringify(value)}`);
    }
  }
});

test('rule 16 — the lines: ids positive integers, text is text, a flag is a flag', () => {
  for (const [body, field] of [
    [{ options: [{ optionId: T }] }, 'optionId'],
    [{ selectedOptions: [{ optionId: 'abc' }] }, 'optionId'],
    [{ options: [{ optionId: 1, inComplement: 'x' }] }, 'inComplement'],
    [{ options: [{ optionId: 1, cardOccurrences: [{ date: T }] }] }, 'cardOccurrences'],
    [{ options: [{ optionId: 1, cardOccurrences: 'x' }] }, 'cardOccurrences'],
    [{ customOptions: [{ description: {} }] }, 'description'],
    [{ customOptions: [{ description: 'x', customOptionId: T }] }, 'customOptionId'],
    [{ customOptions: [{ description: 'x', customKey: T }] }, 'customKey'],
    [{ resources: [{ resourceId: T }] }, 'resourceId'],
    [{ selectedResources: [{ resourceId: 0.5 }] }, 'resourceId'],
    [{ offeredOptionIds: [T] }, 'offeredOptionIds'],
    [{ autoOptionsInComplement: ['x'] }, 'autoOptionsInComplement'],
  ]) {
    const refusal = stayShapeRefusal(body);
    assert.equal(refusal && refusal.code, 'INVALID_FIELD', JSON.stringify(body));
    assert.equal(refusal.field, field);
  }
  assert.equal(stayShapeRefusal({
    options: [{ optionId: 1, inComplement: 0, cardOccurrences: [{ date: app.dates.start, time: '08:00' }] }, { optionId: '2', inComplement: null }],
    customOptions: [{ description: 'x', customOptionId: null, inComplement: true }],
    resources: [{ resourceId: 3 }], offeredOptionIds: [1, '2'], autoOptionsInComplement: [1],
  }), null);
});

test('rule 16 — what the row stores, sent back unchanged, is not judged', () => {
  const stored = { checkInTime: '25:99', platform: '', reservationNumber: 'x'.repeat(80) };
  assert.equal(stayShapeRefusal({ checkInTime: '25:99', reservationNumber: 'x'.repeat(80) }, stored), null);
  assert.equal(stayShapeRefusal({ checkInTime: '26:00' }, stored).code, 'INVALID_TIME');
});

test('rule 16 — preview, create, update, devis create and update all answer it, nothing stored', async () => {
  const { reservation, devis } = app.ids;
  const bad = [
    { checkInTime: 'abc' }, { checkInTime: '25:99' }, { checkOutTime: true }, { checkOutTime: [] }, { checkInTime: {} }, { checkInTime: [1] }, { checkInTime: -1 }, { checkInTime: 1e308 }, { checkInTime: 0.5 },
    { platform: 123 }, { notes: {} }, { reservationNumber: 'x'.repeat(5000) },
    { depositDisabled: 'false' }, { extraGuestSurchargeOffered: 'abc' }, { propertyId: true }, { propertyId: T }, { propertyId: 1e308 }, { propertyId: 0.5 },
    { options: [{ optionId: T }] }, { customOptions: [{ description: {}, amount: 5 }] },
  ];
  for (const patch of bad) {
    for (const [method, url] of [
      ['POST', '/api/reservations/calculate-price'], ['POST', '/api/reservations'], ['PUT', `/api/reservations/${reservation}`], ['POST', '/api/devis'], ['PUT', `/api/devis/${devis}`],
    ]) {
      const res = await app.call(admin, method, url, { ...stay(), startDate: app.dates.freeStart, endDate: app.dates.freeEnd, ...patch });
      assert.equal(res.status, 400, `${method} ${url} ${JSON.stringify(patch).slice(0, 60)} → ${res.status} ${res.text.slice(0, 100)}`);
      assert.match(res.json.code, /^INVALID_(FIELD|TIME)$/);
    }
  }
  const [row] = app.readDb('SELECT platform, notes, checkInTime, depositDisabled FROM reservations WHERE id = ?', reservation);
  assert.deepEqual(row, { platform: 'direct', notes: '', checkInTime: '15:00', depositDisabled: 0 });
});

test('rule 16 — a stored time the guard would refuse is saved back unchanged', async () => {
  const { legacy } = app.ids;
  const [row] = app.readDb('SELECT startDate, endDate FROM reservations WHERE id = ?', legacy);
  const res = await app.call(admin, 'PUT', `/api/reservations/${legacy}`, { ...stay(), ...row, checkInTime: '25:99' });
  assert.equal(res.status, 200, res.text.slice(0, 200));
});

test('rule 16 — a well-formed stay still saves, the empty fields included', async () => {
  const { reservation } = app.ids;
  const res = await app.call(admin, 'PUT', `/api/reservations/${reservation}`, { ...stay(), breakfastTime: null, notes: 'Arrivée tardive', platform: 'direct' });
  assert.equal(res.status, 200, res.text.slice(0, 200));
});

test('rule 16 — PUT without a client, or with one that does not exist, is CLIENT_REQUIRED', async () => {
  const { reservation } = app.ids;
  for (const clientId of [null, '', undefined, 987654]) {
    const res = await app.call(admin, 'PUT', `/api/reservations/${reservation}`, { ...stay(), clientId });
    assert.equal(res.status, 400, `${clientId} → ${res.status} ${res.text.slice(0, 100)}`);
    assert.equal(res.json.code, 'CLIENT_REQUIRED');
  }
  const res = await app.call(admin, 'POST', '/api/reservations', { ...stay(), startDate: app.dates.freeStart, endDate: app.dates.freeEnd, clientId: 987654 });
  assert.equal(res.status, 400);
  assert.equal(res.json.code, 'CLIENT_REQUIRED');
  for (const clientId of [-1, 'abc']) {
    const shape = await app.call(admin, 'PUT', `/api/reservations/${reservation}`, { ...stay(), clientId });
    assert.equal(shape.status, 400);
  }
});

test('rule 16 — a non-numeric :id on a stay\'s write is a 404', async () => {
  for (const [method, url] of [
    ['POST', '/api/reservations/undefined/cancel'], ['PUT', '/api/reservations/abc'], ['PATCH', '/api/reservations/abc/payment'],
    ['POST', '/api/reservations/abc/refunds'], ['POST', '/api/reservations/abc/arrival-payment'], ['DELETE', '/api/reservations/abc'], ['PUT', '/api/reservations/abc/installments'],
  ]) {
    const res = await app.call(admin, method, url, {});
    assert.equal(res.status, 404, `${method} ${url} → ${res.status}`);
  }
});

test('rule 16 — suggest-beds and the devis status refuse a wrong type', async () => {
  for (const body of [{ propertyId: T }, { propertyId: true }, { propertyId: 'abc' }]) {
    const res = await app.call(admin, 'POST', '/api/reservations/suggest-beds', body);
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  for (const body of [{ adults: T }, { adults: 'abc' }, { children: {} }, { teens: true }]) {
    const res = await app.call(admin, 'POST', '/api/reservations/suggest-beds', { propertyId: app.ids.property, ...body });
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  const fine = await app.call(admin, 'POST', '/api/reservations/suggest-beds', { propertyId: app.ids.property, adults: 2, children: 0, teens: 0 });
  assert.equal(fine.status, 200);
  for (const status of [T, 1, true, ['draft']]) {
    const res = await app.call(admin, 'PATCH', `/api/devis/${app.ids.devis}/status`, { status });
    assert.equal(res.status, 400, JSON.stringify(status));
  }
});
