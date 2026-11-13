// specs/pricing-components.md §3 rule 90.2 — the departure SAS's charges (ménage, missing linen, extinguisher) are custom lines of
// source `sas` at moment `departure`, written with the end-of-stay detail in one write; they stay outside the stay's sale, so every
// reader of the stay reads exactly what it read when the detail alone carried them. Real schema, in-memory database; fictional figures.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  db, createStay: createAt, rowOf, getFiche, save, seed, inDays,
} = require('./reservationSaveFixture');
const model = require('../models/reservationsModel');
const extraSales = require('../models/extraSalesModel');
const { departureChargeRows, syncDepartureChargeLines } = require('../utils/departureChargeLines');
const { endOfStayChargesOf, sasDetailAmountAuto } = require('../utils/pricing/settlement');
const { midStayQuoteInputs } = require('../utils/reservationQuoteContext');

seed();
db.prepare("INSERT INTO options (id, title, priceType, price, autoOptionType) VALUES (60, 'Ménage fin de séjour', 'per_stay', 70, 'cleaning')").run();
const TOWEL = Number(db.prepare("INSERT INTO linen_priced_items (label, price, category) VALUES ('Serviette', 6.5, 'bath')").run().lastInsertRowid);
db.prepare("INSERT OR REPLACE INTO repair_amounts (repairKey, label, price) VALUES ('extinguisher_seal', 'Plomb manquant', 30)").run();

let week = 30;
function createStay() {
  week += 7;
  return createAt({ startDate: inDays(week), endDate: inDays(week + 3) });
}

function commit(id, draft = {}) {
  model.commitDepartureSas(id, {
    endOfStayComplementDetail: model.resolveSasDepartureItems(id, draft),
    extinguisherSealOkAtDeparture: draft.extinguisherSealOkAtDeparture,
    extinguisherCharges: draft.extinguisherCharges,
  });
  return rowOf(id);
}
const ALL = {
  cleaningCharged: true,
  missingItems: [{ itemId: TOWEL, qty: 2 }],
  extinguisherSealOkAtDeparture: false,
  extinguisherCharges: [{ repairKey: 'extinguisher_seal', qty: 1 }],
};
const linesOf = (id) => departureChargeRows(db, id).map((r) => ({
  key: r.sasLineKey, description: r.description, amount: r.amount, offered: r.offered, quantity: r.quantity,
  source: r.source, collectAt: r.collectAt, inComplement: r.inComplement,
}));
const MONEY = ['finalPrice', 'depositAmount', 'balanceAmount', 'complementAmount', 'endOfStayComplementAmount', 'endOfStayComplementDetail', 'touristTaxTotal'];
const money = (row) => Object.fromEntries(MONEY.map((k) => [k, row[k]]));

test('rule 90.2 — the departure SAS writes one line per charge, beside the same detail, and moves no finalPrice', () => {
  const id = createStay();
  const before = rowOf(id);
  const after = commit(id, ALL);
  assert.equal(after.finalPrice, before.finalPrice, 'a departure charge is not a sale of the stay');
  assert.equal(after.endOfStayComplementAmount, 70 + 13 + 30);
  assert.deepEqual(linesOf(id), [
    { key: 'departure:label:Ménage de fin de séjour', description: 'Ménage de fin de séjour', amount: 70, offered: 0, quantity: 1, source: 'sas', collectAt: 'departure', inComplement: 0 },
    { key: 'departure:label:Serviette', description: 'Serviette', amount: 13, offered: 0, quantity: 2, source: 'sas', collectAt: 'departure', inComplement: 0 },
    { key: 'departure:ext:extinguisher_seal', description: 'Plomb manquant', amount: 30, offered: 0, quantity: 1, source: 'sas', collectAt: 'departure', inComplement: 0 },
  ]);
  const charges = endOfStayChargesOf(after);
  assert.deepEqual(charges.map((l) => l.label), linesOf(id).map((l) => l.description), 'the lines are the detail\'s charges, in order');
  assert.equal(sasDetailAmountAuto(after.endOfStayComplementDetail), 113);
});

test('rule 90.2 — a re-run updates a line in place, offers it, deletes the one it no longer bills; the ménage is never read as sold', () => {
  const id = createStay();
  commit(id, ALL);
  const ids = new Map(departureChargeRows(db, id).map((r) => [r.sasLineKey, r.id]));
  const after = commit(id, { cleaningCharged: true, cleaningOffered: true, missingItems: [{ itemId: TOWEL, qty: 1 }] });
  assert.equal(after.endOfStayComplementAmount, 6.5);
  const rows = departureChargeRows(db, id);
  assert.deepEqual(rows.map((r) => [r.sasLineKey, r.amount, r.offered, r.quantity]), [
    ['departure:label:Ménage de fin de séjour', 70, 1, 1],
    ['departure:label:Serviette', 6.5, 0, 1],
  ]);
  assert.equal(rows[0].id, ids.get('departure:label:Ménage de fin de séjour'), 'same row, same identity (rule 14)');
  assert.equal(rows[1].id, ids.get('departure:label:Serviette'));
  assert.equal(model.isCleaningSoldForReservation(id), false, 'the departure ménage line is not a ménage sold');
  commit(id, {});
  assert.deepEqual(departureChargeRows(db, id), [], 'nothing billed: no line');
});

test('rule 90.2 — the fiche neither lists nor deletes a departure line; its save leaves the stay as a detail-only twin', async () => {
  const lined = createStay();
  const legacy = createStay();
  commit(lined, ALL);
  commit(legacy, ALL);
  db.prepare("DELETE FROM reservation_custom_options WHERE reservationId = ? AND sasLineKey LIKE 'departure:%'").run(legacy);
  const fiche = getFiche(lined);
  assert.equal((fiche.options || []).some((o) => String(o.sasLineKey || '').startsWith('departure:')), false);
  assert.deepEqual((fiche.customOptions || []), getFiche(legacy).customOptions || []);
  assert.deepEqual(money(rowOf(lined)), money(rowOf(legacy)));
  // The two stays sit on different weeks: their dates are not the subject.
  const undated = (value) => JSON.parse(JSON.stringify(value, (k, v) => (/date/i.test(k) || /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? undefined : v)));
  const sold = (body) => undated({ storedSummary: body.storedSummary, options: (body.options || []).map(({ id, reservationId, ...o }) => o) });
  assert.deepEqual(sold(fiche), sold(getFiche(legacy)), 'the fiche reads the same sale');
  const engine = (id) => { const { arrivalExtrasBaseline, ...rest } = midStayQuoteInputs(db, id); return rest; };
  assert.deepEqual(engine(lined), engine(legacy), 'the engine reads the same charges');
  for (const id of [lined, legacy]) {
    const res = await save(id, { adults: 3 });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  }
  assert.deepEqual(money(rowOf(lined)), money(rowOf(legacy)), 'the save prices both stays alike: no charge billed twice');
  assert.equal(departureChargeRows(db, lined).length, 3, 'the save kept the departure lines');
});

test('rule 90.2 — a stay stored before (detail, no line) gets no line from a later rewrite; a request cannot address a departure line', () => {
  const legacy = createStay();
  db.prepare('UPDATE reservations SET endOfStayComplementAmount = 30, endOfStayComplementDetail = ? WHERE id = ?')
    .run(JSON.stringify([{ label: 'Plomb manquant', repairKey: 'extinguisher_seal', qty: 1, amount: 30 }]), legacy);
  assert.equal(syncDepartureChargeLines(db, legacy, JSON.parse(rowOf(legacy).endOfStayComplementDetail)), 0);
  model.dropBathLinenGhostLine(legacy);
  assert.deepEqual(departureChargeRows(db, legacy), []);
  const lined = createStay();
  commit(lined, ALL);
  const [first] = departureChargeRows(db, lined);
  assert.equal(extraSales.findLine(lined, `custom:${first.lineId}`), null);
});
