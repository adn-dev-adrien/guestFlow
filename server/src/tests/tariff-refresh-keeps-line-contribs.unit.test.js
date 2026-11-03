// specs/reservation-save-keeps-pricing.md rule 20 (review of #954, audit R21-M1's class) — « Utiliser les tarifs
// actuels » and a change of logement drop the stored snapshot so the catalogue prices the lines again. The contribs
// travelled in that snapshot, so a catalogue line came back with none: the journal held on that save, then moved at
// the next priced one, on entries already booked.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const { optionalPlugin, skipWithout } = require('../plugins/sdk/testing');
const {
  db, controller, createStay, inDays, seed, rowOf, mark,
} = require('./ledgerFixture');
const model = require('../models/reservationsModel');
const { toUpdateBody } = require('../utils/reservationUpdateBody');
const { withStoredLineContribs } = require('../utils/storedLineContribs');
const { todayIso } = require('../utils/localDate');

const { create: accountingModel } = optionalPlugin(() => require('../plugins/accounting-export/accountingModel'));
const { create: accountingController } = optionalPlugin(() => require('../plugins/accounting-export/controller'));

const accounting = { skip: skipWithout(['accounting-export']) };
const TODAY = todayIso();
const OPTION = 50;
const SECOND_OPTION = 51;
const LATE_CHECKOUT = 52;
const LOCAL_OPTION = 53;
const RESOURCE = 60;

seed();
db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (?, 'Panier', 'per_stay', 100)").run(OPTION);
db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (?, 'Vin', 'per_stay', 40)").run(SECOND_OPTION);
for (const propertyId of [1, 2]) {
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (?, ?)').run(propertyId, OPTION);
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (?, ?)').run(propertyId, SECOND_OPTION);
}
db.prepare("INSERT INTO resources (id, name, quantity, price, priceType) VALUES (?, 'Vélo', 3, 50, 'per_stay')").run(RESOURCE);

const free = (description, amount) => ({ customKey: description, description, amount, offered: false, inComplement: null });
const line = { optionId: OPTION, quantity: 1 };
const resource = { resourceId: RESOURCE, quantity: 1 };

function csvOfToday() {
  let sent = '';
  const res = { setHeader() {}, status() { return res; }, send(b) { sent = Buffer.from(b).toString('latin1'); return res; } };
  accountingController(accountingModel(db)).salesCsv({ query: { year: Number(TODAY.slice(0, 4)), month: Number(TODAY.slice(5, 7)) } }, res);
  return sent;
}
const optionRows = (id) => db.prepare('SELECT optionId, inComplement, acompteContribTtc AS a, soldeContribTtc AS s FROM reservation_options WHERE reservationId = ? ORDER BY optionId').all(id);
const resourceRows = (id) => db.prepare('SELECT resourceId, inComplement, acompteContribTtc AS a, soldeContribTtc AS s FROM reservation_resources WHERE reservationId = ? ORDER BY resourceId').all(id);
const customRows = (id) => db.prepare('SELECT description, acompteContribTtc AS a, soldeContribTtc AS s FROM reservation_custom_options WHERE reservationId = ? ORDER BY sortOrder, id').all(id);
const save = (id, edit, opts = {}) => {
  const body = { ...toUpdateBody(model.getByIdWithDetails(id)), forceOverpayment: true };
  if (edit) edit(body);
  const result = controller.performUpdate(String(id), body, opts);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result;
};
const refresh = (body) => { body.refreshPricingToCurrent = true; };
const addLine = (body) => body.customOptions.push(free('Ajout', 20));
function paidStay(over) {
  const id = createStay(over);
  assert.equal(mark(id, { depositPaid: true, depositPaidDate: TODAY }).statusCode, 200);
  assert.equal(mark(id, { balancePaid: true, balancePaidDate: TODAY }).statusCode, 200);
  return id;
}
const paidOption = (id) => {
  const [row] = optionRows(id);
  assert.ok(row.a > 0 && row.s > 0, 'the option collected through both payments');
  return row;
};

test('rule 20 — the option keeps its contribs through a refresh, and the next priced save moves nothing', accounting, () => {
  const id = paidStay({ options: [line] });
  const stored = paidOption(id);
  const before = csvOfToday();

  save(id, refresh);
  assert.deepEqual(optionRows(id), [stored]);
  assert.equal(csvOfToday(), before, 'the refresh');

  save(id, addLine);
  assert.deepEqual(optionRows(id), [stored]);
  assert.equal(csvOfToday(), before, 'the later save');
});

test('rule 20 — a refresh and a new line in the same save, beside a paid custom line', accounting, () => {
  const id = paidStay({ options: [line], customOptions: [free('Ligne libre', 80)] });
  const option = paidOption(id);
  const custom = customRows(id);
  const before = csvOfToday();

  save(id, (body) => { refresh(body); addLine(body); });

  assert.deepEqual(optionRows(id), [option]);
  assert.deepEqual(customRows(id).filter((row) => row.description === 'Ligne libre'), custom);
  assert.equal(csvOfToday(), before);
});

test('rule 20 — a resource keeps its contribs too', accounting, () => {
  const id = paidStay({ resources: [resource] });
  const [stored] = resourceRows(id);
  assert.ok(stored.a > 0 && stored.s > 0);
  const before = csvOfToday();

  save(id, refresh);
  save(id, addLine);

  assert.deepEqual(resourceRows(id), [stored]);
  assert.equal(csvOfToday(), before);
});

test('rule 20 — an engine-derived line (late check-out) keeps them', accounting, () => {
  db.prepare(`INSERT INTO options (id, title, priceType, price, autoEnabled, autoOptionType, autoPricingMode)
    VALUES (?, 'Départ tardif', 'per_stay', 30, 1, 'late_check_out', 'fixed')`).run(LATE_CHECKOUT);
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, ?)').run(LATE_CHECKOUT);
  try {
    const id = paidStay({ checkOutTime: '14:00' });
    const [stored] = optionRows(id);
    assert.equal(stored.optionId, LATE_CHECKOUT);
    assert.ok(stored.a > 0 && stored.s > 0);
    const before = csvOfToday();

    save(id, refresh);
    save(id, addLine);

    assert.deepEqual(optionRows(id), [stored]);
    assert.equal(csvOfToday(), before);
  } finally {
    db.prepare('DELETE FROM property_options WHERE optionId = ?').run(LATE_CHECKOUT);
  }
});

test('rule 20 — a catalogue price raised since: the line is re-priced, its contribs stay what it collected', accounting, () => {
  const id = paidStay({ options: [line] });
  const stored = paidOption(id);
  const before = csvOfToday();
  db.prepare('UPDATE options SET price = 130 WHERE id = ?').run(OPTION);
  try {
    save(id, refresh);

    assert.equal(db.prepare('SELECT totalPrice FROM reservation_options WHERE reservationId = ?').get(id).totalPrice, 130);
    assert.deepEqual(optionRows(id), [stored]);
    assert.equal(rowOf(id).complementAmount, 30, 'the growth goes to the complement');
    assert.equal(csvOfToday(), before);
  } finally {
    db.prepare('UPDATE options SET price = 100 WHERE id = ?').run(OPTION);
  }
});

test('rule 20 — a catalogue price lowered since: the line holds what it collected, the journal does not move', accounting, () => {
  const id = paidStay({ options: [line] });
  const stored = paidOption(id);
  const before = csvOfToday();
  db.prepare('UPDATE options SET price = 70 WHERE id = ?').run(OPTION);
  try {
    save(id, refresh);

    assert.equal(db.prepare('SELECT totalPrice FROM reservation_options WHERE reservationId = ?').get(id).totalPrice, 70);
    assert.deepEqual(optionRows(id), [stored]);
    assert.equal(csvOfToday(), before);
  } finally {
    db.prepare('UPDATE options SET price = 100 WHERE id = ?').run(OPTION);
  }
});

test('rule 20 — a change of logement drops the snapshot the same way: a line sold on both keeps its contribs', () => {
  const id = paidStay({ options: [line], resources: [resource] });
  const option = paidOption(id);
  const [stored] = resourceRows(id);

  save(id, (body) => { body.propertyId = 2; });

  assert.equal(rowOf(id).propertyId, 2);
  assert.deepEqual(optionRows(id), [option]);
  assert.deepEqual(resourceRows(id), [stored]);
});

test('rule 20 — a line the new logement does not sell leaves with its contrib', () => {
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (?, 'Local', 'per_stay', 25)").run(LOCAL_OPTION);
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, ?)').run(LOCAL_OPTION);
  const id = paidStay({ options: [line, { optionId: LOCAL_OPTION, quantity: 1 }] });
  const kept = optionRows(id).find((row) => row.optionId === OPTION);

  save(id, (body) => { body.propertyId = 2; });

  assert.deepEqual(optionRows(id), [kept]);
});

test('rule 20 — the admin unlock of a started fiche takes the same branch', () => {
  const id = paidStay({ options: [line] });
  const stored = paidOption(id);
  db.prepare('UPDATE reservations SET startDate = ?, endDate = ? WHERE id = ?').run(inDays(-400), inDays(-397), id);
  db.prepare('SELECT rowid AS row FROM reservation_nights WHERE reservationId = ? ORDER BY date').all(id)
    .forEach((night, index) => db.prepare('UPDATE reservation_nights SET date = ? WHERE rowid = ?').run(inDays(-400 + index), night.row));

  save(id, refresh, { unlockPast: true });

  assert.deepEqual(optionRows(id), [stored]);
});

test('rule 20 — forced to the complement in the same save, the line drops them, like any forced line', () => {
  const id = paidStay({ options: [line] });
  paidOption(id);

  save(id, (body) => { refresh(body); body.options[0].inComplement = 1; });

  const [row] = optionRows(id);
  assert.deepEqual([row.inComplement, row.a, row.s], [1, null, null]);
});

test('rule 20 — a removed line takes them along, the line kept holds its own', () => {
  const id = paidStay({ options: [line, { optionId: SECOND_OPTION, quantity: 1 }] });
  const kept = optionRows(id).find((row) => row.optionId === OPTION);

  save(id, (body) => { refresh(body); body.options = body.options.filter((o) => o.optionId === OPTION); });

  assert.deepEqual(optionRows(id), [kept]);
});

test('rule 20 — a line added in a refresh has no contrib: it never collected', () => {
  const id = paidStay({ options: [line] });
  const stored = paidOption(id);

  save(id, (body) => { refresh(body); body.options.push({ optionId: SECOND_OPTION, quantity: 1 }); });

  assert.deepEqual(optionRows(id).find((row) => row.optionId === OPTION), stored);
  const added = optionRows(id).find((row) => row.optionId === SECOND_OPTION);
  assert.deepEqual([added.a, added.s], [null, null]);
});

test('rule 20 — an ordinary save still reads them from the snapshot, unchanged', accounting, () => {
  const id = paidStay({ options: [line] });
  const stored = paidOption(id);
  const before = csvOfToday();

  save(id, addLine);

  assert.deepEqual(optionRows(id), [stored]);
  assert.equal(csvOfToday(), before);
});

test('rule 20 — a stay nothing was paid on stays without contribs', () => {
  const id = createStay({ options: [line] });

  save(id, refresh);

  const [row] = optionRows(id);
  assert.deepEqual([row.a, row.s], [null, null]);
});

test('rule 20 — the copy touches catalogue lines only, never a custom or a forced one', () => {
  const quote = {
    finalPrice: 100,
    optionLines: [
      { optionId: 1, inComplement: 0, acompteContribTtc: null, soldeContribTtc: null },
      { optionId: 2, inComplement: 1, acompteContribTtc: null, soldeContribTtc: null },
      { optionId: 1, isCustom: true, inComplement: 0, acompteContribTtc: 7, soldeContribTtc: 8 },
      { optionId: 3, inComplement: 0, acompteContribTtc: null, soldeContribTtc: null },
    ],
    resourceLines: [
      { resourceId: 1, inComplement: 0, acompteContribTtc: null, soldeContribTtc: null },
      { resourceId: 2, inComplement: 1, acompteContribTtc: null, soldeContribTtc: null },
    ],
  };
  const snapshot = {
    lockedOptionLines: [
      { optionId: 1, acompteContribTtc: 10, soldeContribTtc: 20 },
      { optionId: 2, acompteContribTtc: 30, soldeContribTtc: 40 },
    ],
    lockedResourceLines: [
      { resourceId: 1, acompteContribTtc: 5, soldeContribTtc: 6 },
      { resourceId: 2, acompteContribTtc: 1, soldeContribTtc: 2 },
    ],
  };

  const carried = withStoredLineContribs(quote, snapshot);

  assert.deepEqual(carried.optionLines.map((l) => [l.acompteContribTtc, l.soldeContribTtc]), [[10, 20], [null, null], [7, 8], [null, null]]);
  assert.deepEqual(carried.resourceLines.map((l) => [l.acompteContribTtc, l.soldeContribTtc]), [[5, 6], [null, null]]);
  assert.equal(carried.finalPrice, 100);
  assert.equal(quote.optionLines[0].acompteContribTtc, null, 'the quote received is left as it is');
});
