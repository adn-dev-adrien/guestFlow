// specs/sas-departure-recap-server-side.md rule 29 and specs/sas-breakfast-and-catering-upsell.md rule 16 (audit R21,
// 2026-11-03) — what the SAS sells or counts is finite and at most 999, whole pieces are safe integers, a per-night
// sale is a stay's worth of nights: refused at the preview as at the commit, before anything is planned or written.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../../database');
const registry = require('../../sdk/registry');
const controller = require('../controller');
const { priceOptionSale } = require('../../../utils/sasOptionSale');

registry.configure({ isActive: () => true, allows: () => true });
registry.ensure('linen');

db.prepare("INSERT INTO properties (id, name, maxGuests) VALUES (1, 'Gîte fictif', 6)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Alex', 'Exemple')").run();
const TOWEL = Number(db.prepare("INSERT INTO linen_priced_items (label, price, category) VALUES ('Serviette', 6.5, 'bath')").run().lastInsertRowid);
const PILLOW = Number(db.prepare("INSERT INTO linen_priced_items (label, price, category) VALUES ('Taie', 3.3, 'bed')").run().lastInsertRowid);
const STAY_LINE = Number(db.prepare("INSERT INTO options (title, priceType, price) VALUES ('Panier', 'per_stay', 20)").run().lastInsertRowid);
const NIGHT_LINE = Number(db.prepare("INSERT INTO options (title, priceType, price) VALUES ('Bois', 'per_night', 5)").run().lastInsertRowid);
const PERSON_LINE = Number(db.prepare("INSERT INTO options (title, priceType, price) VALUES ('Repas', 'per_person', 9)").run().lastInsertRowid);
db.prepare(`INSERT INTO property_options (propertyId, optionId) VALUES (1, ${STAY_LINE}), (1, ${NIGHT_LINE}), (1, ${PERSON_LINE})`).run();

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayAt = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };

let nextId = 800;
function stay(columns) {
  const id = nextId++;
  const cols = { id, kind: 'reservation', clientId: 1, propertyId: 1, platform: 'direct', adults: 2, complementAmount: 0, ...columns };
  const keys = Object.keys(cols);
  db.prepare(`INSERT INTO reservations (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map((k) => cols[k]));
  return id;
}
const arrivalStay = () => stay({ startDate: dayAt(0), endDate: dayAt(3) });
const departureStay = () => stay({ startDate: dayAt(-3), endDate: dayAt(0) });

function call(fn, id, body, user = { id: 1, roles: ['admin'] }) {
  const res = {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  controller[fn]({ params: { id: String(id) }, body, user, query: {} }, res);
  return res;
}

function assertRefused(fn, id, body, label) {
  const res = call(fn, id, body);
  assert.equal(res.statusCode, 400, `${fn} ${label}: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.error, 'INVALID_QUANTITY', `${fn} ${label}`);
}

const NOT_WHOLE_PIECES = [1000, 1e15, 1e308, Infinity, 1.5, -1, 'abc', '1e309', '9'.repeat(400), {}, [2], true];
const NOT_UNITS = [1000, 1e15, 1e308, Infinity, -1, 'abc', '1e309', '9'.repeat(400), {}, [2], true];

test('sas-breakfast-and-catering-upsell rule 16: sold units beyond 999 or not finite are refused, preview and commit, and nothing is written', () => {
  const id = arrivalStay();
  for (const fn of ['previewArrival', 'commitArrival']) {
    for (const units of NOT_UNITS) assertRefused(fn, id, { soldOptions: [{ optionId: STAY_LINE, units }] }, `units ${String(units).slice(0, 12)}`);
  }
  const row = db.prepare('SELECT arrivalSasDoneAt, complementAmount FROM reservations WHERE id = ?').get(id);
  assert.equal(row.arrivalSasDoneAt, null);
  assert.equal(row.complementAmount, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_options WHERE reservationId = ?').get(id).n, 0);
});

test('sas-breakfast-and-catering-upsell rule 16: a reception session is held to the same refusal', () => {
  const id = arrivalStay();
  const res = call('commitArrival', id, { soldOptions: [{ optionId: STAY_LINE, units: 1e308 }] }, { id: 2, roles: ['reception'] });
  assert.equal(res.statusCode, 400, JSON.stringify(res.body));
  assert.equal(res.body.error, 'INVALID_QUANTITY');
});

test('sas-breakfast-and-catering-upsell rule 16: fractional units stay what a per-stay sale allows, up to 999', () => {
  const id = arrivalStay();
  for (const units of [1.5, 999, 0]) {
    assert.equal(call('previewArrival', id, { soldOptions: [{ optionId: STAY_LINE, units }] }).statusCode, 200, String(units));
  }
});

test('sas-breakfast-and-catering-upsell rule 16: a per-night sale is a whole number of nights, at most 366', () => {
  const id = arrivalStay();
  for (const units of [367, 999, 1.5]) assertRefused('previewArrival', id, { soldOptions: [{ optionId: NIGHT_LINE, units }] }, `nights ${units}`);
  assert.equal(call('previewArrival', id, { soldOptions: [{ optionId: NIGHT_LINE, units: 366 }] }).statusCode, 200);
  assert.equal(call('previewArrival', id, { soldOptions: [{ optionId: NIGHT_LINE, units: 0 }] }).statusCode, 200);
});

test('sas-breakfast-and-catering-upsell rule 16: people served must be finite and at most 999; a valid number is still capped by the capacity', () => {
  const id = arrivalStay();
  for (const persons of [1000, 1e308, Infinity, 'abc', {}]) assertRefused('previewArrival', id, { soldOptions: [{ optionId: PERSON_LINE, persons }] }, `persons ${String(persons)}`);
  const capped = call('previewArrival', id, { soldOptions: [{ optionId: PERSON_LINE, persons: 999 }] });
  assert.equal(capped.statusCode, 200, JSON.stringify(capped.body));
});

test('sas-breakfast-and-catering-upsell rule 16: a line this SAS already sold, sent back unchanged at re-opening, is not re-judged', () => {
  const id = arrivalStay();
  db.prepare(`INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, inComplement, sasArrivalOrigin)
              VALUES (?, ?, 1, 5, 1.26, 'per_night', 6.3, 1, 1)`).run(id, NIGHT_LINE);
  db.prepare(`INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, inComplement, sasArrivalOrigin)
              VALUES (?, ?, 1200, 20, 1200, 'per_stay', 24000, 1, 1)`).run(id, STAY_LINE);
  const res = call('previewArrival', id, { soldOptions: [{ optionId: NIGHT_LINE, units: 1.26 }, { optionId: STAY_LINE, units: 1200 }] });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assertRefused('previewArrival', id, { soldOptions: [{ optionId: NIGHT_LINE, units: 1.5 }] }, 'changed');
  assertRefused('previewArrival', id, { soldOptions: [{ optionId: STAY_LINE, units: 1201 }] }, 'changed');
});

test('sas-breakfast-and-catering-upsell rule 16: the unchanged-units exemption covers only what this SAS sold', () => {
  const id = arrivalStay();
  db.prepare(`INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, inComplement, sasArrivalOrigin)
              VALUES (?, ?, 1200, 20, 1200, 'per_stay', 24000, 0, 0)`).run(id, STAY_LINE);
  assertRefused('previewArrival', id, { soldOptions: [{ optionId: STAY_LINE, units: 1200 }] }, 'a fiche line sent back');
});

test('sas-departure-recap-server-side rule 29: linen pieces at arrival are a safe integer of at most 999, preview and commit', () => {
  const id = arrivalStay();
  for (const fn of ['previewArrival', 'commitArrival']) {
    for (const qty of NOT_WHOLE_PIECES) assertRefused(fn, id, { linenItems: [{ itemId: PILLOW, qty }] }, `qty ${String(qty).slice(0, 12)}`);
  }
  assert.equal(db.prepare('SELECT arrivalSasDoneAt FROM reservations WHERE id = ?').get(id).arrivalSasDoneAt, null);
  assert.equal(call('previewArrival', id, { linenItems: [{ itemId: PILLOW, qty: 999 }] }).statusCode, 200);
});

test('sas-departure-recap-server-side rule 29: missing pieces at departure are a safe integer of at most 999, preview and commit', () => {
  const id = departureStay();
  for (const fn of ['previewDeparture', 'commitDeparture']) {
    for (const qty of NOT_WHOLE_PIECES) assertRefused(fn, id, { missingItems: [{ itemId: TOWEL, qty }] }, `qty ${String(qty).slice(0, 12)}`);
  }
  const row = db.prepare('SELECT departureSasDoneAt, endOfStayComplementAmount FROM reservations WHERE id = ?').get(id);
  assert.equal(row.departureSasDoneAt, null);
  assert.equal(Number(row.endOfStayComplementAmount || 0), 0);
  assert.equal(call('previewDeparture', id, { missingItems: [{ itemId: TOWEL, qty: 999 }] }).statusCode, 200);
});

test('sas-departure-recap-server-side rule 29: a line that names no count is refused, a null one counts nothing', () => {
  const arrival = arrivalStay();
  const departure = departureStay();
  for (const fn of ['previewArrival', 'commitArrival']) assertRefused(fn, arrival, { linenItems: [{ itemId: PILLOW }] }, 'no qty');
  for (const fn of ['previewDeparture', 'commitDeparture']) assertRefused(fn, departure, { missingItems: [{ itemId: TOWEL }] }, 'no qty');
  assert.equal(call('previewArrival', arrival, { linenItems: [{ itemId: PILLOW, qty: null }] }).statusCode, 200);
  assert.equal(call('previewDeparture', departure, { missingItems: [{ itemId: TOWEL, qty: null }] }).statusCode, 200);
});

test('sas-departure-recap-server-side rule 29: an extinguisher charge is counted the same way', () => {
  require('../settings').bind({ settings: { declare() {}, get: () => '1' } });
  const id = departureStay();
  for (const qty of [1000, 1e308, Infinity, 'abc']) {
    assertRefused('previewDeparture', id, { extinguisherSealOkAtDeparture: false, extinguisherCharges: [{ repairKey: 'x', qty }] }, `qty ${String(qty)}`);
  }
});

test('sas-breakfast-and-catering-upsell rule 16: the pure pricing never returns a non-finite line', () => {
  const stayNight = { id: NIGHT_LINE, priceType: 'per_night', price: 5 };
  const stayLine = { id: STAY_LINE, priceType: 'per_stay', price: 20 };
  for (const units of [Infinity, '1e309']) {
    assert.equal(priceOptionSale(stayNight, { unitPrice: 5, persons: 4, nights: 3, units }), null);
    assert.equal(priceOptionSale(stayLine, { unitPrice: 20, persons: 4, nights: 3, units }), null);
  }
});

// specs/sas-breakfast-and-catering-upsell.md rule 16, reading of 2026-11-04, and specs/non-card-option-served-persons.md
// rule 35 (audit R22): a sent `persons` is a whole number from 1 to 999. An invalid count never sells the whole party.
test('sas-breakfast-and-catering-upsell rule 16: persons not a whole number from 1 to 999 is refused, preview and commit, on a per-person option', () => {
  for (const persons of [-5, -1, 0, 0.5, 0.001, 1.5, '-5', '0', 1000, 1e15, Infinity, 'abc', true, [2], {}]) {
    for (const fn of ['previewArrival', 'commitArrival']) {
      const id = arrivalStay();
      const res = call(fn, id, { soldOptions: [{ optionId: PERSON_LINE, persons }] });
      assert.equal(res.statusCode, 400, `${fn} ${String(persons)}: ${JSON.stringify(res.body)}`);
      assert.equal(res.body.error, 'INVALID_QUANTITY');
      assert.match(res.body.message, /Personnes servies/);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_options WHERE reservationId = ?').get(id).n, 0);
    }
  }
  for (const persons of [1, 2, '2', 999, null, undefined, '']) {
    const res = call('previewArrival', arrivalStay(), { soldOptions: [{ optionId: PERSON_LINE, persons }] });
    assert.notEqual(res.body?.error, 'INVALID_QUANTITY', String(persons));
  }
});

test('sas-breakfast-and-catering-upsell rule 16: persons this SAS already stored, sent back unchanged, is not re-judged', () => {
  const id = arrivalStay();
  db.prepare(`INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, cardPersons, sasArrivalOrigin)
              VALUES (?, ${PERSON_LINE}, 1, 9, 1.5, 'per_person', 13.5, 1.5, 1)`).run(id);
  assert.notEqual(call('previewArrival', id, { soldOptions: [{ optionId: PERSON_LINE, persons: 1.5 }] }).body?.error, 'INVALID_QUANTITY');
  assert.equal(call('previewArrival', id, { soldOptions: [{ optionId: PERSON_LINE, persons: 2.5 }] }).body?.error, 'INVALID_QUANTITY');
});

test('sas-departure-recap-server-side rule 30: a breakfast count that is not a usable number ≥ 0 is refused, preview and commit, and never stored', () => {
  const fields = ['breakfastCoffee', 'breakfastTea', 'breakfastChocolate', 'breakfastMilk', 'breakfastPastries', 'breakfastCereals', 'breakfastBread'];
  for (const field of fields) {
    for (const value of [1e999, 1e308, Number.MAX_SAFE_INTEGER + 2, -1, 'abc', '1e999', true, [1], {}]) {
      for (const fn of ['previewArrival', 'commitArrival']) {
        const id = arrivalStay();
        const res = call(fn, id, { [field]: value });
        assert.equal(res.statusCode, 400, `${fn} ${field} ${String(value)}: ${JSON.stringify(res.body)}`);
        assert.equal(res.body.error, 'INVALID_QUANTITY');
        assert.equal(db.prepare(`SELECT ${field} AS v FROM reservations WHERE id = ?`).get(id).v ?? 0, 0);
      }
    }
  }
  const id = arrivalStay();
  const ok = call('commitArrival', id, { breakfastCoffee: 2, breakfastBread: 1.5, breakfastTea: '1', breakfastMilk: '', breakfastCereals: null });
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  const row = db.prepare('SELECT breakfastCoffee, breakfastBread, breakfastTea FROM reservations WHERE id = ?').get(id);
  assert.deepEqual({ ...row }, { breakfastCoffee: 2, breakfastBread: 1.5, breakfastTea: 1 });
});

test('sas-departure-recap-server-side rule 30: the model called directly throws on a count it cannot store, it never writes Infinity', () => {
  const reservationsModel = require('../../../models/reservationsModel');
  const id = arrivalStay();
  assert.throws(() => reservationsModel.commitArrivalSas(id, { breakfastBread: Infinity }), /Quantité invalide/);
  assert.throws(() => reservationsModel.commitArrivalSas(id, { breakfastCoffee: 1e308 }), /Quantité invalide/);
  assert.equal(db.prepare('SELECT breakfastBread AS v FROM reservations WHERE id = ?').get(id).v ?? 0, 0);
});
