// specs/pricing-components.md §3 rule 79 reading (stabilisation loop t17, D17-1, 2026-11-18 — the data reviewer's `p4` probe made permanent).
// The writer of the free lines takes the row the save's judges chose (`matchStoredCustomLines` over the posted lines), never a text
// comparison of its own: a line posted without its row id whose label differs from its row by case or spacing only is the same line for
// the judges AND the writer — it keeps its number and its discount, and a note that paid it does not refuse the save LINE_PAID. The SAS
// marker (rule 33) rides the row it was stored on. Every label variant is derived from the key the judges read (`extraLineKey`).
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, addDaysToIsoDate } = require('./saleRound1Fixtures');
const ctrl = require('../controllers/reservationsController');
const lines = require('../models/bookingLinesModel');
const { storedBody } = require('../utils/stayOrderLines');
const { extraLineKey } = require('../utils/pricing/storedLines');
const { matchStoredCustomLines, pricedCustomLinesNamingRows } = require('../utils/storedCustomLines');
const { isPricedCustomLine } = require('../utils/pricing/steps/extras');
const { changeLine } = require('../utils/extraSale');

const keyOf = (label) => extraLineKey({ isCustom: true, title: label });
const swapCase = (text) => [...text].map((c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase())).join('');
// Every spelling the judges read as the stored label: case, outer and inner spacing. Each is checked against the judges' key, so the
// table follows `extraLineKey` if it ever changes.
const variantsOf = (label) => {
  const variants = [label.toLowerCase(), label.toUpperCase(), swapCase(label), `  ${label} `, label.replace(/ /g, '   ')];
  for (const variant of variants) assert.equal(keyOf(variant), keyOf(label), `${JSON.stringify(variant)} is the label for the judges`);
  return [...new Set(variants)].filter((variant) => variant !== label);
};

const rowsOf = (id) => db.prepare('SELECT id, lineId, description, discountCents, sasArrivalOrigin, sasLineKey, quantity FROM reservation_custom_options WHERE reservationId = ? ORDER BY sortOrder, id').all(id);

const MOMENTS = { beforeArrival: { offset: -3, checkIn: 0 }, started: { offset: 1, checkIn: 1 } };
const VARIANTS = {
  plain: () => {},
  discounted: (id, stored) => changeLine(id, `custom:${stored.lineId}`, { discount: { amount: 2 } }, { now: new Date() }),
  paidByNote: (id, stored) => db.prepare('UPDATE reservations SET midStaySettledNotes = ? WHERE id = ?')
    .run(JSON.stringify([{ id: 'n1', lines: [{ key: keyOf(stored.description), amount: 15 }] }]), id),
};

for (const label of ['Bois', 'Bois sec']) {
  for (const [moment, m] of Object.entries(MOMENTS)) {
    for (const [variant, prepare] of Object.entries(VARIANTS)) {
      for (const text of variantsOf(label)) {
        test(`D17-1 — ${moment} × ${variant}: « ${label} » posted without id as ${JSON.stringify(text)} keeps its row`, (t) => {
          const id = stay(20);
          t.mock.timers.enable({ apis: ['Date'], now: new Date(`${addDaysToIsoDate(row(id).startDate, m.offset)}T12:00:00`).getTime() });
          try {
            db.prepare('UPDATE reservations SET checkInDone = ? WHERE id = ?').run(m.checkIn, id);
            assert.equal(ctrl.performUpdate(id, { ...storedBody(id), customOptions: [{ customKey: 'c1', description: label, amount: 15, newLine: true }] }, { now: new Date() }).status, 200);
            prepare(id, rowsOf(id)[0]);
            const before = rowsOf(id)[0];
            const result = ctrl.performUpdate(id, { ...storedBody(id), customOptions: [{ customKey: 'c1', description: text, amount: 15 }] }, { now: new Date() });
            assert.equal(result.status, 200, JSON.stringify(result.body));
            const after = rowsOf(id);
            assert.equal(after.length, 1);
            assert.equal(after[0].lineId, before.lineId, 'the line keeps its number');
            assert.equal(after[0].discountCents, before.discountCents, 'the line keeps its discount');
          } finally { t.mock.timers.reset(); }
        });
      }
    }
  }
}

// Every caller of the writer that hands it stored rows: the save (above, resolved by the controller) and `replaceCustomOptions` (devis, copy
// of a stay's lines, plugins), which matches with the same function.
test('D17-1 — replaceCustomOptions: a re-cased line without id keeps its row and its SAS marker; a line the caller appends takes neither', () => {
  const id = stay(30);
  const insert = db.prepare(`INSERT INTO reservation_custom_options (reservationId, lineId, description, amount, sortOrder, sasArrivalOrigin, sasLineKey, quantity)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  insert.run(id, 9101, 'Bois', 15, 0, 1, 'sas-bois', 3);
  insert.run(id, 9102, 'Bouquet', 12, 1, 0, null, 1);
  lines.replaceCustomOptions(id, [
    { isCustom: true, title: 'BOIS', totalPrice: 15 },
    { isCustom: true, title: 'bouquet', totalPrice: 12, newLine: true },
  ]);
  const after = rowsOf(id);
  assert.deepEqual(after.map((r) => [r.description, r.sasArrivalOrigin, r.sasLineKey, r.quantity]), [
    ['BOIS', 1, 'sas-bois', 3],
    ['bouquet', 0, null, 1],
  ]);
  assert.equal(after[0].lineId, 9101);
  assert.notEqual(after[1].lineId, 9102, 'an appended line takes a number of its own');
});

test('D17-1 — replaceCustomOptions: two SAS lines of one label keep their own key; a line renamed under its id keeps its marker', () => {
  const id = stay(31);
  const insert = db.prepare(`INSERT INTO reservation_custom_options (reservationId, lineId, description, amount, sortOrder, sasArrivalOrigin, sasLineKey, quantity)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)`);
  const first = Number(insert.run(id, 9201, 'Bain', 20, 0, 'k-1', 1).lastInsertRowid);
  const second = Number(insert.run(id, 9202, 'Bain', 20, 1, 'k-2', 2).lastInsertRowid);
  lines.replaceCustomOptions(id, [
    { isCustom: true, title: 'Bain du soir', totalPrice: 20, customOptionId: second },
    { isCustom: true, title: 'bain', totalPrice: 20 },
  ]);
  assert.deepEqual(rowsOf(id).map((r) => [r.description, r.lineId, r.sasLineKey, r.quantity]), [
    ['Bain du soir', 9202, 'k-2', 2],
    ['bain', 9201, 'k-1', 1],
  ]);
  assert.ok(first < second);
});

// The controller pairs the priced lines with the posted ones through the engine's own rule (`isPricedCustomLine`): a blank or 0 € posted
// line takes its row for the judges and gives it to no priced line.
test('D17-1 — pricedCustomLinesNamingRows: each priced line names the row the judges chose for its posted line, by posted order', () => {
  const stored = [{ id: 7, description: 'Bois' }, { id: 8, description: 'Bois' }];
  const posted = [
    { description: '', amount: 10 },
    { description: 'Bois', amount: 0, customOptionId: 7 },
    { description: 'bois', amount: 15 },
    { description: 'BOIS', amount: 15, newLine: true },
    { description: 'Pain', amount: 4 },
  ];
  const judged = matchStoredCustomLines(posted, stored).map((r) => (r ? r.id : null));
  assert.deepEqual(judged, [null, 7, 8, null, null]);
  const priced = [{ optionId: 1, title: 'Bière' }, ...posted.filter(isPricedCustomLine).map((line) => ({ isCustom: true, title: line.description.trim(), customOptionId: line.customOptionId }))];
  const resolved = pricedCustomLinesNamingRows(posted, priced, stored);
  assert.deepEqual(resolved[0], { optionId: 1, title: 'Bière' });
  assert.deepEqual(resolved.slice(1).map((line) => [line.title, line.customOptionId ?? null, Boolean(line.newLine)]), [
    ['bois', 8, false],
    ['BOIS', null, true],
    ['Pain', null, true],
  ]);
});

test('D17-1 — the engine prices exactly the posted lines isPricedCustomLine keeps, in order (the pairing rule)', () => {
  const id = stay(32);
  const posted = [
    { description: '  ', amount: 9 }, { description: 'A', amount: 0 }, { description: 'B', amount: 5 },
    { description: 'C', amount: -3 }, { description: 'D', amount: 0.001 }, { description: ' E ', amount: 7 },
  ];
  const { calculateReservationQuote } = require('../utils/pricing');
  const quote = calculateReservationQuote({ ...storedBody(id), db, customOptions: posted });
  assert.deepEqual(quote.optionLines.filter((line) => line.isCustom).map((line) => line.title),
    posted.filter(isPricedCustomLine).map((line) => line.description.trim()));
});
