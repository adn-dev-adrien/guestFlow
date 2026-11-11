// specs/sas-departure-recap-server-side.md rules 1-2, 6-12, 24 — the departure plan: one function that
// prices the intent, nets the offered lines, sums the end-of-stay complement and the recalled arrival,
// shared by the preview and the commit. Real model, in-memory database; fictional figures.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const model = require('../models/reservationsModel');
const {
  storedLineKey, classifyStoredLines, recalledArrivalAfter, isRecalled, realOfStoredLine, storeLine,
} = require('../utils/departureSasPlan');

db.prepare("INSERT INTO properties (id, name, maxGuests) VALUES (1, 'Gîte fictif', 6)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Alex', 'Exemple')").run();
const TOWEL = Number(db.prepare("INSERT INTO linen_priced_items (label, price, category) VALUES ('Serviette', 6.5, 'bath')").run().lastInsertRowid);
const SHEET = Number(db.prepare("INSERT INTO linen_priced_items (label, price, category) VALUES ('Drap housse', 12, 'bed')").run().lastInsertRowid);
const CLEANING_OPTION = Number(db.prepare("INSERT INTO options (title, priceType, price, autoOptionType) VALUES ('Ménage', 'per_stay', 80, 'cleaning')").run().lastInsertRowid);
db.prepare("INSERT OR REPLACE INTO repair_amounts (repairKey, label, price) VALUES ('extinguisher_seal', 'Plomb manquant', 30)").run();

let nextId = 700;
function stay(columns = {}) {
  const id = nextId++;
  const cols = {
    id, kind: 'reservation', clientId: 1, propertyId: 1, startDate: '2099-01-01', endDate: '2099-01-03',
    platform: 'direct', adults: 2, complementAmount: 0, ...columns,
  };
  const keys = Object.keys(cols);
  db.prepare(`INSERT INTO reservations (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map((k) => cols[k]));
  return id;
}

// What the controller does: resolve the intent, then plan the commit's own input.
function plan(id, draft = {}, options) {
  const items = model.resolveSasDepartureItems(id, draft);
  return model.planDepartureSas(id, {
    endOfStayComplementDetail: items,
    extinguisherSealOkAtDeparture: draft.extinguisherSealOkAtDeparture,
    extinguisherCharges: draft.extinguisherCharges,
    offeredArrivalExtras: draft.offeredArrivalExtras,
  }, options);
}
function commit(id, draft = {}, extra = {}) {
  model.commitDepartureSas(id, {
    endOfStayComplementDetail: model.resolveSasDepartureItems(id, draft),
    extinguisherSealOkAtDeparture: draft.extinguisherSealOkAtDeparture,
    extinguisherCharges: draft.extinguisherCharges,
    offeredArrivalExtras: draft.offeredArrivalExtras,
    ...extra,
  });
  return db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
}
const lineOf = (p, key) => p.lines.find((l) => l.key === key);
const detailOf = (id) => JSON.parse(db.prepare('SELECT endOfStayComplementDetail FROM reservations WHERE id = ?').get(id).endOfStayComplementDetail || '[]');
const stored = (...lines) => JSON.stringify(lines);

test('rule 7 — the end-of-stay ménage is a yes/no priced by the server; offered keeps the real price', () => {
  const id = stay();
  const billed = plan(id, { cleaningCharged: true });
  assert.equal(billed.endOfStayTotal, 80);
  assert.deepEqual(lineOf(billed, 'depCleaning'), {
    key: 'depCleaning', group: 'endOfStay', label: 'Ménage de fin de séjour', qty: 1, unitPrice: 80, real: 80, billed: 80, offerable: true, offered: false,
  });
  const offered = plan(id, { cleaningCharged: true, cleaningOffered: true });
  assert.equal(offered.endOfStayTotal, 0);
  assert.equal(lineOf(offered, 'depCleaning').real, 80, 'the real price stays visible');
  assert.equal(plan(id, { cleaningCharged: false }).endOfStayTotal, 0);
});

test('rule 7 — a cleaning already sold is never billed, and a stored ménage line is dropped', () => {
  const id = stay();
  db.prepare("INSERT INTO reservation_custom_options (reservationId, description, amount, inComplement) VALUES (?, 'Ménage', 0, 0)").run(id);
  assert.equal(plan(id, { cleaningCharged: true }).endOfStayTotal, 0);
  const rerun = stay({
    endOfStayComplementAmount: 80,
    endOfStayComplementDetail: stored({ label: 'Ménage de fin de séjour', qty: 1, unitPrice: 80, amount: 80 }),
  });
  db.prepare("INSERT INTO reservation_custom_options (reservationId, description, amount, inComplement) VALUES (?, 'Ménage', 0, 0)").run(rerun);
  const after = commit(rerun, { cleaningCharged: true });
  assert.equal(after.endOfStayComplementAmount, 0);
  assert.equal(after.endOfStayComplementDetail, null);
});

test('rule 6 — missing linen is priced from « Facturables »; an unknown item or a quantity of 0 is dropped', () => {
  const id = stay();
  const p = plan(id, { missingItems: [{ itemId: TOWEL, qty: 2 }, { itemId: SHEET, qty: 0 }, { itemId: 99999, qty: 3 }] });
  assert.equal(p.endOfStayTotal, 13);
  assert.deepEqual(p.lines.map((l) => [l.key, l.label, l.qty, l.unitPrice, l.real]), [[`dep:${TOWEL}`, 'Serviette', 2, 6.5, 13]]);
  db.prepare('UPDATE linen_priced_items SET price = 7 WHERE id = ?').run(TOWEL);
  assert.equal(plan(id, { missingItems: [{ itemId: TOWEL, qty: 2 }] }).endOfStayTotal, 14, 'the price in force at the time, not the one the dialog loaded');
  db.prepare('UPDATE linen_priced_items SET price = 6.5 WHERE id = ?').run(TOWEL);
});

test('rule 8 — the extinguisher is priced by the planner and its page subtotal is served', () => {
  const id = stay();
  const p = plan(id, { extinguisherSealOkAtDeparture: 0, extinguisherCharges: [{ repairKey: 'extinguisher_seal', qty: 1 }] });
  assert.equal(p.extinguisherTotal, 30);
  assert.equal(p.endOfStayTotal, 30);
  const offered = plan(id, { extinguisherSealOkAtDeparture: 0, extinguisherCharges: [{ repairKey: 'extinguisher_seal', qty: 1, offered: true }] });
  assert.equal(offered.extinguisherTotal, 0);
  assert.equal(lineOf(offered, 'ext:extinguisher_seal').real, 30);
  assert.equal(plan(id, { extinguisherSealOkAtDeparture: 1, extinguisherCharges: [{ repairKey: 'extinguisher_seal', qty: 1 }] }).endOfStayTotal, 0, 'in good condition: nothing billed');
});

test('rule 9 — a carried line is kept without being sent; offered by its key; a stale key bills it', () => {
  const id = stay({
    endOfStayComplementAmount: 24,
    endOfStayComplementDetail: stored({ label: 'Linge de toilette', qty: 1, unitPrice: 24, amount: 24, source: 'arrivalBathLinen' }),
  });
  const kept = plan(id, {});
  assert.equal(kept.endOfStayTotal, 24, 'kept as stored although the draft says nothing');
  const key = kept.lines[0].key;
  assert.match(key, /^stored:0:[0-9a-f]{8}$/);
  const offered = plan(id, { storedLines: [{ key, offered: true }] });
  assert.equal(offered.endOfStayTotal, 0);
  assert.equal(offered.lines[0].real, 24);
  const stale = plan(id, { storedLines: [{ key: 'stored:0:00000000', offered: true }] });
  assert.equal(stale.endOfStayTotal, 24, 'a key that matches nothing is ignored: billed at its real price');
});

test('rule 9 — a stored offered line keeps its real price and can be un-offered', () => {
  const id = stay({
    endOfStayComplementAmount: 0,
    endOfStayComplementDetail: stored({
      label: 'Panier du matin', qty: 2, unitPrice: 8, amount: 0, offered: 1, originalAmount: 16,
    }),
  });
  const seed = model.buildDepartureSeed(id);
  assert.equal(seed.storedKeys.length, 1);
  assert.deepEqual(seed.offeredKeys, seed.storedKeys);
  const p = plan(id, {});
  assert.equal(p.lines[0].offered, true);
  assert.equal(p.lines[0].real, 16);
  assert.equal(plan(id, { storedLines: [{ key: p.lines[0].key, offered: false }] }).endOfStayTotal, 16);
});

test('rule 10, Q4 — the « Ajustement » line is never a recap line; the announced amount wins at the commit', () => {
  const id = stay({
    endOfStayComplementAmountOverride: 50,
    endOfStayComplementAmount: 50,
    endOfStayComplementDetail: stored(
      { label: 'Serviette', qty: 2, unitPrice: 6.5, amount: 13 },
      { label: 'Ajustement', qty: 1, unitPrice: -37, amount: -37, source: 'adjustment' },
    ),
  });
  const p = plan(id, { cleaningCharged: true, missingItems: [{ itemId: TOWEL, qty: 2 }] });
  assert.equal(p.lines.some((l) => l.label === 'Ajustement'), false);
  assert.equal(p.endOfStayTotal, 50, 'the announced amount, not announced + added');
  assert.deepEqual(p.adjusted, { endOfStay: { amount: 50, engineAmount: 93 }, arrival: null });
  // The fixture the open question asked for: an adjustment to 50 € keeps 50 € after a check-out adding 13 €.
  const after = commit(id, { cleaningCharged: true, missingItems: [{ itemId: TOWEL, qty: 2 }] });
  assert.equal(after.endOfStayComplementAmount, 50);
  assert.equal(detailOf(id).filter((l) => l.source === 'adjustment').length, 1, 'one adjustment line, recomputed');
});

test('rule 11 — the recalled arrival: remainder + lit bébé merged with the end-of-stay lines, offered netting, framing', () => {
  const id = stay({ complementAmount: 12.5 });
  db.prepare("INSERT INTO reservation_custom_options (reservationId, description, amount, inComplement) VALUES (?, 'Lit bébé', 7.7, 1)").run(id);
  const customId = db.prepare('SELECT id FROM reservation_custom_options WHERE reservationId = ?').get(id).id;
  const merged = plan(id, { cleaningCharged: true });
  assert.deepEqual(merged.recall, { shown: true, framing: 'merged', total: 12.5 });
  assert.equal(merged.grandTotal, 92.5);
  assert.equal(lineOf(merged, `custom:${customId}`).offerable, true);
  assert.equal(merged.lines.find((l) => l.label === "Complément d'arrivée").offerable, false, 'the un-itemised remainder is never offered');
  const offered = plan(id, { cleaningCharged: true, offeredArrivalExtras: [{ kind: 'custom', id: customId }] });
  assert.equal(offered.recall.total, 4.8);
  assert.equal(offered.grandTotal, 84.8);
  const alone = plan(id, {});
  assert.equal(alone.recall.framing, 'alone');
  assert.equal(alone.grandTotal, 12.5);
});

test('rule 11 — a paid arrival complement, or one worth 0 €, is not recalled and its offered set is ignored', () => {
  const paid = stay({ complementAmount: 7.7, complementPaid: 1 });
  db.prepare("INSERT INTO reservation_custom_options (reservationId, description, amount, inComplement) VALUES (?, 'Lit bébé', 7.7, 1)").run(paid);
  const p = plan(paid, { offeredArrivalExtras: [] });
  assert.equal(p.recall, null);
  assert.equal(p.offeredRefs, undefined);
  const zero = stay({ complementAmount: 0 });
  db.prepare("INSERT INTO reservation_custom_options (reservationId, description, amount, inComplement, offered) VALUES (?, 'Lit bébé', 7.7, 1, 1)").run(zero);
  const customId = db.prepare('SELECT id FROM reservation_custom_options WHERE reservationId = ?').get(zero).id;
  const q = plan(zero, { offeredArrivalExtras: [] });
  assert.equal(q.recall, null);
  const after = commit(zero, { offeredArrivalExtras: [] });
  assert.equal(after.complementAmount, 0);
  assert.equal(db.prepare('SELECT offered FROM reservation_custom_options WHERE id = ?').get(customId).offered, 1, 'the gesture is not billed back');
});

test('rule 24 — an adjusted arrival complement: offering a recalled line leaves the announced amount', () => {
  const id = stay({ complementAmount: 12.5, complementAmountOverride: 10 });
  db.prepare("INSERT INTO reservation_custom_options (reservationId, description, amount, inComplement) VALUES (?, 'Lit bébé', 7.7, 1)").run(id);
  const customId = db.prepare('SELECT id FROM reservation_custom_options WHERE reservationId = ?').get(id).id;
  const p = plan(id, { offeredArrivalExtras: [{ kind: 'custom', id: customId }] });
  assert.equal(p.recall.total, 10);
  assert.deepEqual(p.adjusted.arrival, { amount: 10, engineAmount: 4.8 });
  assert.equal(commit(id, { offeredArrivalExtras: [{ kind: 'custom', id: customId }] }).complementAmount, 10, 'the commit stores what the plan said');
});

test('rule 13 — the mid-stay notes already collected are informative, never in the total', () => {
  const id = stay({
    midStaySettledNotes: JSON.stringify([{ id: 1, total: 33.33, items: [] }]),
    endOfStayComplementDetail: null,
  });
  const p = plan(id, { cleaningCharged: true });
  assert.equal(p.midStaySettled, 33.33);
  assert.equal(p.grandTotal, 80);
});

test('rules 2, 3 — the plan reads and writes nothing; the commit stores exactly the planned totals', () => {
  const id = stay({ complementAmount: 12.5 });
  db.prepare("INSERT INTO reservation_custom_options (reservationId, description, amount, inComplement) VALUES (?, 'Lit bébé', 7.7, 1)").run(id);
  const draft = { cleaningCharged: true, missingItems: [{ itemId: TOWEL, qty: 2 }], offeredArrivalExtras: [] };
  const before = JSON.stringify(db.prepare('SELECT * FROM reservations WHERE id = ?').get(id));
  const p = plan(id, draft);
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM reservations WHERE id = ?').get(id)), before, 'planning writes nothing');
  assert.equal(p.grandTotal, 105.5);
  const row = commit(id, draft);
  assert.equal(row.endOfStayComplementAmount, p.endOfStayTotal);
  assert.equal(row.complementAmount, p.recall.total);
  assert.equal(row.endOfStayComplementAmount + row.complementAmount, p.grandTotal);
});

test('edge — re-opened with an unchanged draft: the stored total, never doubled; the seed rebuilds the decisions', () => {
  const id = stay({ departureSasDoneAt: '2099-01-03 10:00:00' });
  const draft = { cleaningCharged: true, cleaningOffered: false, missingItems: [{ itemId: TOWEL, qty: 2 }] };
  commit(id, draft);
  const seed = model.buildDepartureSeed(id);
  assert.deepEqual(seed.missingItems, { [TOWEL]: 2 });
  assert.equal(seed.cleaningCharged, true);
  const again = commit(id, { ...draft, storedLines: seed.storedKeys.map((key) => ({ key, offered: false })) });
  assert.equal(again.endOfStayComplementAmount, 93);
  assert.equal(commit(id, draft).endOfStayComplementAmount, 93);
});

test('rule 12 — a legacy row (no departureSasDoneAt) with a stored linen line is seeded too, not dropped by the next commit', () => {
  const id = stay({
    endOfStayComplementDetail: stored({ label: 'Serviette', qty: 2, unitPrice: 6.5, amount: 13 }),
  });
  const seed = model.buildDepartureSeed(id);
  assert.deepEqual(seed.missingItems, { [TOWEL]: 2 });
  assert.deepEqual(seed.storedKeys, []);
  const again = commit(id, { missingItems: Object.entries(seed.missingItems).map(([itemId, qty]) => ({ itemId: Number(itemId), qty })) });
  assert.equal(again.endOfStayComplementAmount, 13, 'the line survives the commit');
});

test('rule 24 — an adjustment with no real line behind it gets its own visible, not offerable line', () => {
  const id = stay({ complementAmount: 30, complementAmountOverride: null, endOfStayComplementAmountOverride: 20 });
  db.prepare("INSERT INTO reservation_custom_options (reservationId, description, amount, inComplement) VALUES (?, 'Panier', 30, 1)").run(id);
  const p = plan(id, {});
  assert.equal(p.endOfStayTotal, 20);
  assert.equal(p.grandTotal, 50);
  const adjustment = p.lines.find((l) => l.group === 'adjustment');
  assert.deepEqual(adjustment, {
    key: null, group: 'adjustment', label: 'Ajustement', qty: 1, unitPrice: 20, real: 20, billed: 20, offerable: false, offered: false,
  });
  assert.equal(p.recall.framing, 'merged');
  // With a real line behind it, the note says it and no line is added.
  assert.equal(plan(id, { cleaningCharged: true }).lines.some((l) => l.group === 'adjustment'), false);
});

test('pure — a stored line key changes with the line; the classification tells rebuilt from kept', () => {
  const a = { label: 'Panier', amount: 8, qty: 1, unitPrice: 8 };
  assert.equal(storedLineKey(a, 2).split(':')[1], '2');
  assert.notEqual(storedLineKey(a, 2), storedLineKey({ ...a, amount: 9 }, 2));
  assert.equal(storedLineKey({ ...a, offered: 1, amount: 0, originalAmount: 8 }, 2), storedLineKey(a, 2), 'offering does not change the identity');
  const { carried, preserved, rebuilt } = classifyStoredLines([
    { label: 'Linge', source: 'arrivalBathLinen', amount: 5 },
    { label: 'Plomb', repairKey: 'extinguisher_seal', amount: 30 },
    { label: 'Ménage de fin de séjour', amount: 80 },
    { label: 'Serviette', amount: 13 },
    { label: 'Panier', amount: 8 },
    { label: 'Ajustement', source: 'adjustment', amount: -3 },
  ], new Set(['Serviette']), 'Ménage de fin de séjour');
  assert.deepEqual(carried.map((e) => e.line.label), ['Linge']);
  assert.deepEqual(preserved.map((e) => e.line.label), ['Panier']);
  assert.deepEqual(rebuilt.map((e) => e.kind), ['extinguisher', 'cleaning', 'linen']);
});

test('pure — recalledArrivalAfter, isRecalled, storeLine', () => {
  assert.deepEqual(recalledArrivalAfter({ stored: 12.5, delta: -7.7, override: null }), { total: 4.8, engineAmount: 4.8, adjusted: false });
  assert.deepEqual(recalledArrivalAfter({ stored: 12.5, delta: -7.7, override: 10 }), { total: 10, engineAmount: 4.8, adjusted: true });
  assert.deepEqual(recalledArrivalAfter({ stored: 10, delta: 0, override: 10 }), { total: 10, engineAmount: 10, adjusted: false });
  assert.equal(recalledArrivalAfter({ stored: 3, delta: -9, override: null }).total, 0, 'never negative');
  assert.equal(isRecalled({ amount: 12.5, paid: 0 }), true);
  assert.equal(isRecalled({ amount: 12.5, paid: 1 }), false);
  assert.equal(isRecalled({ amount: 0, paid: 0 }), false);
  assert.deepEqual(storeLine({ lineKey: 'x', label: 'A', qty: 1, unitPrice: 8, amount: 8, offered: true }), {
    label: 'A', qty: 1, unitPrice: 8, amount: 0, offered: 1, originalAmount: 8,
  });
  assert.equal(realOfStoredLine({ offered: 1, amount: 0, qty: 2, unitPrice: 5 }), 10, 'an offered row without originalAmount falls back to qty × unitPrice');
});
