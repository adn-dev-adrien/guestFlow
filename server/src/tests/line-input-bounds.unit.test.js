// specs/reservations-backend-mvc.md rule 15 and specs/non-card-option-served-persons.md rule 27 (audit R21, 2026-11-03)
// — one boundary guard for every option, party and amount number of a reservation or devis write: refused,
// never clamped, the same on the preview, the save and the quote; a stored line sent back unchanged is not re-judged.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./reservationSaveFixture');
const devis = require('../models/devisModel');
const { toUpdateBody } = require('../utils/reservationUpdateBody');
const { lineInputRefusal, refuseInvalidServedPersons } = require('../utils/lineInputBounds');
const { typedCountAlerts } = require('../utils/typedCounts');

const NIGHTLY = 60;
const PER_PERSON = 61;
const PER_STAY = 50;

test.before(() => {
  f.seed();
  f.db.prepare(`INSERT INTO options (id, title, priceType, price) VALUES
    (${NIGHTLY}, 'Bois', 'per_night', 10), (${PER_PERSON}, 'Linge', 'per_person', 8)`).run();
  f.db.prepare(`INSERT INTO property_options (propertyId, optionId) VALUES (1, ${NIGHTLY}), (1, ${PER_PERSON})`).run();
});

let month = 0;
// Each stay takes its own window, so no two overlap.
function dates() {
  month += 1;
  return { startDate: f.inDays(30 + month * 5), endDate: f.inDays(33 + month * 5) };
}

// The window every refused request names: a refusal comes first, so they never collide.
const PROBE = () => ({ startDate: f.inDays(1500), endDate: f.inDays(1503) });

async function preview(body) {
  const res = f.respond();
  await f.controller.calculatePrice({ body: { propertyId: 1, adults: 2, ...PROBE(), ...body }, user: f.ADMIN }, res);
  return res;
}

const create = (body) => f.create(f.stayBody({ ...PROBE(), ...body }));

async function update(id, over) {
  const res = f.respond();
  await f.controller.update({ params: { id: String(id) }, body: f.ficheBody(id, over), user: f.ADMIN, query: {} }, res);
  return res;
}

const devisBody = (over) => ({ propertyId: 1, clientId: 1, adults: 2, ...PROBE(), ...over });
const asOptions = (line) => ({ options: [line] });
const asSelected = (line) => ({ selectedOptions: [line] });

let stayForPaths;
let quoteForPaths;

/** Every write path, its answer brought to `{ status, code }`. */
async function everyPath(fields) {
  const { options, selectedOptions, ...rest } = fields;
  stayForPaths = stayForPaths || f.createStay(dates());
  quoteForPaths = quoteForPaths || devis.create({ ...devisBody({}), ...dates() }).data.id;
  const lines = { options: options || [], selectedOptions: selectedOptions || options || [] };
  const forStay = { ...rest, ...(options ? { options: lines.options } : {}) };
  const forQuote = { ...rest, ...(options ? { selectedOptions: lines.selectedOptions } : {}) };
  const out = {};
  const answer = (res) => ({ status: res.statusCode, code: res.body && res.body.code });
  out.preview = answer(await preview(forQuote));
  out.create = answer(create(forStay));
  out.update = answer(await update(stayForPaths, forStay));
  const made = devis.create(devisBody(forQuote));
  out.devisCreate = { status: made.status, code: made.code };
  const edited = devis.update(quoteForPaths, forQuote);
  out.devisUpdate = { status: edited.status, code: edited.code };
  return out;
}

async function assertRefusedEverywhere(fields, code, label) {
  const out = await everyPath(fields);
  for (const [path, answer] of Object.entries(out)) {
    assert.deepEqual(answer, { status: 400, code }, `${label} on ${path}`);
  }
}

test('non-card-option-served-persons rule 27: a typed number of nights is a whole number from 1 to 366, on every path', async () => {
  const bad = [0, -3, 0.5, 2.5, 367, 400, 1e6, 1e15, 1e308, Infinity, 'abc', '1e309', 'Infinity', '0x10', [2], {}, { a: 1 }, true, false];
  for (const cardNights of bad) {
    await assertRefusedEverywhere(asOptions({ optionId: NIGHTLY, quantity: 1, cardNights }), 'INVALID_CARD_NIGHTS', `cardNights ${String(cardNights)}`);
  }
});

test('non-card-option-served-persons rule 27: a typed number of people is a whole number from 1, on every path', async () => {
  const bad = [0, -1, 0.5, 2.5, 2.9, 1e308, Infinity, 'abc', '1e309', [2], {}, true];
  for (const cardPersons of bad) {
    await assertRefusedEverywhere(asOptions({ optionId: PER_PERSON, quantity: 1, cardPersons }), 'INVALID_CARD_PERSONS', `cardPersons ${String(cardPersons)}`);
  }
});

test('non-card-option-served-persons rule 27: absent, null and empty still mean « follows », and 366 is allowed', async () => {
  for (const cardNights of [undefined, null, '', 1, 2, '2', 366]) {
    const out = await everyPath(asOptions({ optionId: NIGHTLY, quantity: 1, ...(cardNights === undefined ? {} : { cardNights }), forceTypedCounts: true }));
    for (const [path, answer] of Object.entries(out)) {
      assert.ok(!answer.code || !answer.code.startsWith('INVALID_'), `${path} ${String(cardNights)} ${answer.code}`);
    }
  }
  assert.equal(lineInputRefusal(asOptions({ optionId: PER_PERSON, cardPersons: 3 })), null);
  assert.equal(lineInputRefusal(asSelected({ optionId: PER_PERSON, cardPersons: '3' })), null);
});

test('reservations-backend-mvc rule 15: an option or resource quantity must be a finite number; 0 and negative stay « line off »', async () => {
  for (const quantity of [Infinity, -Infinity, 1e308, '1e309', 'abc', '1,5', {}, { a: 1 }, [1], true]) {
    await assertRefusedEverywhere(asOptions({ optionId: PER_STAY, quantity }), 'INVALID_QUANTITY', `quantity ${String(quantity)}`);
  }
  for (const quantity of [0, -1, 0.75, 1.1, '2', '', null]) {
    assert.equal(lineInputRefusal(asOptions({ optionId: PER_STAY, quantity })), null, String(quantity));
  }
  assert.equal(lineInputRefusal({ resources: [{ resourceId: 1, quantity: Infinity }] }).code, 'INVALID_QUANTITY');
  assert.equal(lineInputRefusal({ selectedResources: [{ resourceId: 1, quantity: 'x' }] }).code, 'INVALID_QUANTITY');
});

test('reservations-backend-mvc rule 15: party numbers must be finite, on every path', async () => {
  for (const field of ['adults', 'children', 'teens', 'babies', 'babyBeds', 'singleBeds', 'doubleBeds']) {
    for (const value of [Infinity, '1e309', 'abc', {}, [1], 1e308]) {
      await assertRefusedEverywhere({ [field]: value }, 'INVALID_QUANTITY', `${field} ${String(value)}`);
    }
  }
  assert.equal(lineInputRefusal({ adults: 2, children: '1', teens: '', babies: null, babyBeds: 0 }), null);
});

test('reservations-backend-mvc rule 15: a custom amount must be finite, on every path, and nothing is stored', async () => {
  const line = (amount) => ({ customKey: 'k', description: 'Extra', amount });
  for (const amount of [Infinity, '1e309', 'abc', {}, 1e308]) {
    await assertRefusedEverywhere({ customOptions: [line(amount)] }, 'INVALID_AMOUNT', `amount ${String(amount)}`);
  }
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM reservation_custom_options WHERE amount > 1e300').get().n, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM reservations WHERE finalPrice > 1e300 OR balanceAmount > 1e300').get().n, 0);
  for (const amount of [12.5, '12.5', 0, '', null]) {
    assert.equal(lineInputRefusal({ customOptions: [line(amount)] }), null, String(amount));
  }
  for (const key of ['acompteContribTtc', 'soldeContribTtc']) {
    assert.equal(lineInputRefusal({ customOptions: [{ ...line(5), [key]: Infinity }] }).code, 'INVALID_AMOUNT');
    assert.equal(lineInputRefusal({ customOptions: [{ ...line(5), [key]: null }] }), null);
  }
});

test('reservations-backend-mvc rule 15: lines present but not an array of objects answer 400, never a 500', async () => {
  for (const shape of ['abc', {}, { a: 1 }, 7, true, [null], ['x'], [1], [[]]]) {
    await assertRefusedEverywhere({ options: shape }, 'INVALID_LINES', `options ${JSON.stringify(shape)}`);
    await assertRefusedEverywhere({ customOptions: shape }, 'INVALID_LINES', `customOptions ${JSON.stringify(shape)}`);
    assert.equal((await preview({ selectedOptions: shape })).body.code, 'INVALID_LINES');
    assert.equal(create({ resources: shape }).body.code, 'INVALID_LINES');
    assert.equal((await preview({ selectedResources: shape })).body.code, 'INVALID_LINES');
    assert.equal(devis.create(devisBody({ selectedResources: shape })).code, 'INVALID_LINES');
  }
  for (const shape of ['abc', { a: 1 }, 7]) {
    assert.equal(create({ offeredOptionIds: shape }).body.code, 'INVALID_LINES');
  }
  assert.equal(lineInputRefusal({ options: null, customOptions: undefined, resources: [] }), null);
});

test('reservations-backend-mvc rule 15: the alerts of a quote read lines that are not an array as none', () => {
  assert.deepEqual(typedCountAlerts({ quoteLines: [], requestLines: 'abc', persons: 2, nights: 2 }), []);
});

test('non-card-option-served-persons rule 27: a stored count sent back unchanged is not re-judged, a changed one is', async () => {
  const id = f.createStay(dates());
  f.db.prepare(`INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, cardPersons)
                VALUES (?, ${PER_PERSON}, 1, 8, 2.5, 'per_person', 20, 2.5)`).run(id);
  f.db.prepare(`INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, cardNights)
                VALUES (?, ${NIGHTLY}, 1, 10, 400, 'per_night', 4000, 400)`).run(id);
  const lines = [{ optionId: PER_PERSON, quantity: 1, cardPersons: 2.5 }, { optionId: NIGHTLY, quantity: 1, cardNights: 400 }];

  const quoted = f.respond();
  await f.controller.calculatePrice({ body: { propertyId: 1, adults: 2, startDate: f.rowOf(id).startDate, endDate: f.rowOf(id).endDate, reservationId: id, selectedOptions: lines }, user: f.ADMIN }, quoted);
  assert.equal(quoted.statusCode, 200, JSON.stringify(quoted.body).slice(0, 200));

  const saved = await update(id, { options: lines, forceTypedCounts: true });
  assert.notEqual(saved.body.code, 'INVALID_CARD_PERSONS');
  assert.notEqual(saved.body.code, 'INVALID_CARD_NIGHTS');
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body).slice(0, 200));

  const changed = await update(id, { options: [{ optionId: NIGHTLY, quantity: 1, cardNights: 401 }], forceTypedCounts: true });
  assert.deepEqual([changed.statusCode, changed.body.code], [400, 'INVALID_CARD_NIGHTS']);
});

test('non-card-option-served-persons rule 27: the server\'s own update body passes the guard with a stored fractional count on a devis (an archived line)', () => {
  const made = devis.create({ ...devisBody({ selectedOptions: [{ optionId: PER_PERSON, quantity: 1 }] }), ...dates() });
  assert.equal(made.status, 201);
  const id = made.data.id;
  f.db.prepare('UPDATE reservation_options SET cardPersons = 1.5, quantity = 0.75, billedUnits = 1.5 WHERE reservationId = ?').run(id);
  const sent = [{ optionId: PER_PERSON, quantity: 0.75, cardPersons: 1.5 }];
  const again = devis.update(id, { selectedOptions: sent, forceTypedCounts: true });
  assert.notEqual(again.code, 'INVALID_CARD_PERSONS', JSON.stringify(again));
  assert.equal(devis.update(id, { selectedOptions: [{ optionId: PER_PERSON, quantity: 0.75, cardPersons: 1.75 }], forceTypedCounts: true }).code, 'INVALID_CARD_PERSONS');
});

test('non-card-option-served-persons rule 27: a reservation saved back from its own stored body still passes', async () => {
  const id = f.createStay({ ...dates(), options: [{ optionId: NIGHTLY, quantity: 1, cardNights: 2 }, { optionId: PER_PERSON, quantity: 1, cardPersons: 1 }], forceTypedCounts: true });
  const full = f.getFiche(id);
  const body = toUpdateBody(full, new Set());
  const res = f.respond();
  await f.controller.update({ params: { id: String(id) }, body, user: f.ADMIN, query: {} }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body).slice(0, 200));
});

test('the helper refuses by the same rules for a bare list of lines', () => {
  assert.equal(refuseInvalidServedPersons([{ optionId: 1, cardNights: 367 }]).code, 'INVALID_CARD_NIGHTS');
  assert.equal(refuseInvalidServedPersons([{ optionId: 1, cardNights: 366 }]), null);
});
