require('./isolatedDb');
// specs/public-api.md rule 22 (audit R21, public findings 1 and 2) — what a JSON body may hold beyond a string
// or a number is the field's refusal, in the nested envelope: `{"toString":1}` used to throw (500, a stack per
// call), `true` or `[1]` used to be coerced and stored (a client named « True », a notes line « [object Object] »,
// a CGV acceptance from `Number(true) === 1`). Strings and numbers the site really sends are unchanged.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const { validateStayInput, validateGuest, toNonNegativeInt } = require('../publicInputValidation');

const pad = (n) => String(n).padStart(2, '0');
const localDay = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const TODAY = localDay(0);
const stay = { propertyId: 1, startDate: localDay(30), endDate: localDay(33), adults: 2 };
const guest = { firstName: 'Zoé', lastName: 'Martin', email: 'zoe@example.test', phone: '0612345678' };

// What JSON.parse really hands over: an own, non-callable `toString` makes String(), Number() and RegExp.test() throw.
const EVIL = JSON.parse('{"toString":1}');
const NOT_SCALAR = [EVIL, {}, [], [1], ['2'], true, false];

function withMocks(modules, fn) {
  const origRequire = Module.prototype.require;
  Module.prototype.require = function patched(id) {
    if (Object.prototype.hasOwnProperty.call(modules, id)) return modules[id];
    return origRequire.call(this, id);
  };
  try { return fn(); } finally { Module.prototype.require = origRequire; }
}

function controller({ termsRequired = false, current = null } = {}) {
  const mod = '../controllers/publicBookingRequestController';
  const refuseWrite = () => { throw new Error('nothing may be written'); };
  return withMocks({
    '../../database': { transaction: (fn) => fn, prepare: () => ({ get: () => ({ maxGuests: 10 }), run: refuseWrite, all: () => [] }) },
    '../../models/clientsModel': { findByEmail: refuseWrite, create: refuseWrite },
    '../../models/devisModel': { create: refuseWrite },
    './publicCatalogController': { computeBlockedDates: () => [], rangeHasBlockedNight: () => false },
    './publicQuoteController': { buildEngineQuote: () => ({}), checkOptionApplicability: () => null, checkResourceApplicability: () => null },
    '../settings': { termsSettings: () => ({ requireTermsAcceptance: termsRequired }), recordPluginVersion: () => {} },
    '../../models/termsModel': { getCurrent: () => current, insertAcceptance: refuseWrite },
  }, () => {
    delete require.cache[require.resolve(mod)];
    return require(mod);
  });
}

function create(body, options) {
  const res = {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
  };
  controller(options).create({ body, query: {} }, res);
  return res;
}

const assertRefused = (res, code, field) => {
  assert.equal(res.statusCode, 422, JSON.stringify(res.body));
  assert.equal(res.body.error.code, code);
  assert.equal(typeof res.body.error.message, 'string');
  if (field) assert.ok(res.body.error.details.some((d) => d.field === field), JSON.stringify(res.body.error.details));
};

test('rule 22 — a count or an id that is neither a number nor a string is refused, never coerced', () => {
  for (const value of NOT_SCALAR) assert.ok(Number.isNaN(toNonNegativeInt(value, 7)), JSON.stringify(value));
  assert.equal(toNonNegativeInt(3), 3);
  assert.equal(toNonNegativeInt('3'), 3);
  assert.equal(toNonNegativeInt(undefined, 7), 7);
  assert.equal(toNonNegativeInt(null, 7), 7);
  assert.equal(toNonNegativeInt('', 7), 7);
  for (const field of ['propertyId', 'adults', 'children', 'teens', 'babies', 'babyBeds']) {
    for (const value of NOT_SCALAR) {
      const out = validateStayInput({ ...stay, [field]: value }, { todayIso: TODAY });
      assert.equal(out.ok, false, `${field}=${JSON.stringify(value)}`);
      assert.ok(out.errors.some((e) => e.field === field), JSON.stringify(out.errors));
    }
  }
});

test('rule 22 — an arrival or departure time must be a string', () => {
  for (const field of ['checkInTime', 'checkOutTime']) {
    for (const value of [EVIL, {}, [], ['10:00'], true, 1000]) {
      const out = validateStayInput({ ...stay, [field]: value }, { todayIso: TODAY });
      assert.equal(out.ok, false, `${field}=${JSON.stringify(value)}`);
      assert.deepEqual(out.errors, [{ field, issue: 'must be HH:MM' }]);
    }
    assert.equal(validateStayInput({ ...stay, [field]: '16:00' }, { todayIso: TODAY }).value[field], '16:00');
    assert.equal(validateStayInput({ ...stay, [field]: '' }, { todayIso: TODAY }).ok, true);
  }
});

test('rule 22 — option and resource lines: an id or a quantity that is not a number or a string is the line\'s refusal', () => {
  for (const [list, id] of [['options', 'optionId'], ['resources', 'resourceId']]) {
    for (const value of NOT_SCALAR) {
      const badId = validateStayInput({ ...stay, [list]: [{ [id]: value, quantity: 1 }] }, { todayIso: TODAY });
      assert.ok(badId.errors.some((e) => e.field === `${list}[0].${id}`), JSON.stringify(badId));
      const badQty = validateStayInput({ ...stay, [list]: [{ [id]: 1, quantity: value }] }, { todayIso: TODAY });
      assert.ok(badQty.errors.some((e) => e.field === `${list}[0].quantity`), JSON.stringify(badQty));
    }
    const fine = validateStayInput({ ...stay, [list]: [{ [id]: '4', quantity: '2' }] }, { todayIso: TODAY });
    assert.deepEqual(fine.value[list], [{ [id]: 4, quantity: 2 }]);
    assert.deepEqual(validateStayInput({ ...stay, [list]: [{ [id]: 4 }] }, { todayIso: TODAY }).value[list], [{ [id]: 4, quantity: 1 }]);
  }
});

test('rule 22 — a guest that is not an object is an empty guest: every field is required, nothing throws', () => {
  for (const value of [null, undefined, 1, 'x', true, [], EVIL]) {
    const out = validateGuest(value);
    assert.equal(out.ok, false, JSON.stringify(value));
    assert.deepEqual(out.errors.map((e) => e.field), ['guest.firstName', 'guest.lastName', 'guest.email', 'guest.phone']);
    assert.ok(out.errors.every((e) => e.reason === 'required'));
  }
});

test('rule 22 — a guest field that is not a string reads as empty: no client named « True » or « [object Object] »', () => {
  for (const field of ['firstName', 'lastName', 'email', 'phone']) {
    for (const value of [EVIL, {}, [], ['a@b.fr'], true, 1.5, 33612345678]) {
      const out = validateGuest({ ...guest, [field]: value });
      assert.equal(out.ok, false, `${field}=${JSON.stringify(value)}`);
      assert.deepEqual(out.errors.map((e) => [e.field, e.reason]), [[`guest.${field}`, 'required']]);
    }
  }
  assert.deepEqual(validateGuest(guest).value, guest);
});

test('rule 22 — POST /booking-requests with hostile values answers the nested 422, never a throw', () => {
  for (const [patch, field] of [
    [{ propertyId: EVIL }, 'propertyId'],
    [{ adults: EVIL }, 'adults'],
    [{ babyBeds: EVIL }, 'babyBeds'],
    [{ checkInTime: EVIL }, 'checkInTime'],
    [{ options: [{ optionId: EVIL }] }, 'options[0].optionId'],
    [{ resources: [{ resourceId: 1, quantity: EVIL }] }, 'resources[0].quantity'],
    [{ guest: null }, 'guest.firstName'],
    [{ guest: { ...guest, firstName: true } }, 'guest.firstName'],
    [{ guest: { ...guest, phone: EVIL } }, 'guest.phone'],
  ]) {
    assertRefused(create({ ...stay, guest, ...patch }), 'VALIDATION_FAILED', field);
  }
});

test('rule 22 — a request with no parsed body (non-JSON content type) is the stay\'s refusal', () => {
  assertRefused(create(undefined), 'VALIDATION_FAILED', 'propertyId');
});

test('rule 22 — a message that is not a string is refused, not stored as « [object Object] »', () => {
  for (const message of [EVIL, {}, [], [1], true, false, 0, 1.5]) {
    assertRefused(create({ ...stay, guest, message }), 'VALIDATION_FAILED', 'message');
  }
});

test('rule 22 — a filled honeypot of any shape is still the silent success, with nothing written', () => {
  for (const _hp of [EVIL, {}, true, 1, 'x']) {
    const res = create({ ...stay, guest, _hp });
    assert.equal(res.statusCode, 201, JSON.stringify(_hp));
    assert.deepEqual(res.body, { data: { status: 'pending' } });
  }
  assertRefused(create({ _hp: '   ', adults: 2 }), 'VALIDATION_FAILED', 'propertyId');
  assertRefused(create({ _hp: null, adults: 2 }), 'VALIDATION_FAILED', 'propertyId');
});

test('rule 22 — the CGV version is an integer or digits: `true` and `[1]` are no acceptance', () => {
  const current = { version: 1 };
  const { checkTermsAcceptance } = controller({ termsRequired: true, current });
  for (const sent of [true, [1], ['1'], EVIL, {}, false, 1.5, '1.5', ' 1', '1e0', 'x']) {
    const out = checkTermsAcceptance(sent);
    assert.equal(out.code, 'TERMS_OUTDATED', JSON.stringify(sent));
    assert.equal(out.status, 409);
  }
  for (const sent of [1, '1']) assert.deepEqual(checkTermsAcceptance(sent), { version: current });
  for (const sent of [undefined, null, '']) assert.equal(checkTermsAcceptance(sent).code, 'TERMS_NOT_ACCEPTED');
});

// specs/public-api.md rule 20, reading of 2026-11-04 (audit R22, public finding 3).
test('rule 20 — a name with no letter nor digit is « required », a control character never stored', () => {
  for (const name of ['\u0000', '\u0007', '\u0001\u0002', '\u0085', '\u001b', '\u2800', '\u200D', '\uFEFF', '  ', '---']) {
    for (const field of ['firstName', 'lastName']) {
      const out = validateGuest({ ...guest, [field]: name });
      assert.equal(out.ok, false, JSON.stringify(name));
      assert.ok(out.errors.some((e) => e.field === `guest.${field}` && e.reason === 'required'), JSON.stringify(out.errors));
    }
  }
  assert.equal(validateGuest({ ...guest, firstName: '\u001bZoé' }).value.firstName, 'Zoé');
  assert.equal(validateGuest({ ...guest, lastName: 'A\nB' }).value.lastName, 'A B');
});

test('rule 20 — a name of Hangul fillers shows nothing: « required », and D13 keeps its alphabet', () => {
  for (const name of ['\u3164', '\u115F', '\u1160', '\uFFA0', '\u3164\u3164', '\u3164\u1160', '\u3164\u0301', ' \u3164 ']) {
    for (const field of ['firstName', 'lastName']) {
      const out = validateGuest({ ...guest, [field]: name });
      assert.equal(out.ok, false, JSON.stringify(name));
      assert.ok(out.errors.some((e) => e.field === `guest.${field}` && e.reason === 'required'), JSON.stringify(out.errors));
    }
  }
  for (const name of ['\u3164김', '김\uFFA0민', '김민']) assert.equal(validateGuest({ ...guest, firstName: name }).value.firstName, name);
});

test('rule 20 — names the site really sends are unchanged', () => {
  for (const name of ['Zoé', 'O\'Neil', 'Marie-Anne', 'Иван', '李', 'سارا\u200Cی']) {
    assert.equal(validateGuest({ ...guest, firstName: name }).value.firstName, name);
  }
});
