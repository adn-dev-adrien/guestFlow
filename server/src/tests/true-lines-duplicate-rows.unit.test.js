// specs/pricing-components.md §3 rules 13 and 85 (line key scheme) — a database that already holds TWO rows of one article on one stay
// (the line tables lost their article key): every path that addresses a line by its article touches exactly the intended row(s), and every
// reader returns every row. One block per path, cited by its inventory class (LINE moved to lineId, AGG aggregated on purpose).
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, optionId, bath, wine, stayWithTwoSales, rowsOf, quoteOf,
} = require('./trueLinesFixture');

test('rule 85 — the fixture really holds two rows of one article on one stay', () => {
  const id = stayWithTwoSales();
  assert.deepEqual(rowsOf(id).map((r) => [r.optionId, r.totalPrice]), [[bath, 40], [bath, 90], [wine, 25]]);
});

test('rule 85 (engine) — each stored row prices from its OWN snapshot; the first keeps the legacy key, the later one is named by its line', () => {
  const id = stayWithTwoSales();
  const [first, second] = rowsOf(id);
  const lines = quoteOf(id).optionLines.filter((l) => l.optionId === bath).sort((a, b) => a.totalPrice - b.totalPrice);
  assert.deepEqual(lines.map((l) => l.totalPrice), [40, 90], 'neither line took the other one\'s snapshot');
  assert.equal(lines[0].lineKey, undefined, 'the first line of the article is unchanged: no new field, legacy key');
  assert.equal(lines[1].lineKey, `line:reservation_options:${second.lineId}`);
  assert.equal(lines[1].lineId, second.lineId);
  assert.ok(first.lineId < second.lineId);
});

test('rule 85 (lineFacts, allocations, refunds) — each row has its own key: the first the legacy one, the later one its line ref', () => {
  const id = stayWithTwoSales();
  const [first, second] = rowsOf(id);
  db.prepare('UPDATE reservation_options SET discountCents = 500 WHERE lineId = ?').run(second.lineId);
  const facts = require('../models/ports/stayRepository').create(db).lineFacts(id);
  assert.equal(facts[`opt:${bath}`].lineId, first.lineId);
  assert.equal(facts[`opt:${bath}`].discountCents, 0);
  assert.equal(facts[`line:reservation_options:${second.lineId}`].discountCents, 500, 'the second row\'s fact is no longer dropped');
  const { lineRefsByKey } = require('../utils/paymentAllocationsSync');
  const refs = lineRefsByKey(db, id);
  assert.equal(refs.get(`opt:${bath}`), `line:reservation_options:${first.lineId}`);
  assert.equal(refs.get(`line:reservation_options:${second.lineId}`), `line:reservation_options:${second.lineId}`);
  const { isResourceKey } = require('../utils/pricing/lineKeys');
  assert.deepEqual(['res:3', 'line:reservation_resources:9', 'opt:3', 'line:reservation_options:9'].map(isResourceKey), [true, true, false, false]);
});

test('rule 85 (LINE: forceItemContribsCapture) — the stored split and the capture write each row its own share, never the last row\'s over the first', () => {
  const id = stayWithTwoSales();
  const [first, second] = rowsOf(id);
  const { captureStoredSplit } = require('../utils/forceItemContribsCapture');
  db.prepare('UPDATE reservations SET depositAmount = 130, depositPaid = 1 WHERE id = ?').run(id);
  captureStoredSplit({ db, reservation: db.prepare('SELECT * FROM reservations WHERE id = ?').get(id), bucket: 'deposit' });
  const shares = Object.fromEntries(rowsOf(id).map((r) => [r.lineId, r.acompteContribTtc]));
  assert.ok(shares[first.lineId] > 0 && shares[second.lineId] > 0);
  assert.notEqual(shares[first.lineId], shares[second.lineId], 'the two rows hold different shares (40 vs 90)');
  assert.ok(Math.abs(shares[second.lineId] / shares[first.lineId] - 90 / 40) < 0.05, 'in proportion to what each row is owed');
});

test('rule 85 (LINE: storedLineContribs) — a later sale takes the contribs of ITS stored row', () => {
  const { withStoredLineContribs } = require('../utils/storedLineContribs');
  const quote = { optionLines: [{ optionId: 5, totalPrice: 40 }, { optionId: 5, lineId: 9, lineKey: 'line:reservation_options:9', totalPrice: 90 }], resourceLines: [] };
  const stored = [{ lineId: 4, optionId: 5, acompteContribTtc: 10, soldeContribTtc: 30 }, { lineId: 9, optionId: 5, acompteContribTtc: 20, soldeContribTtc: 70 }];
  const out = withStoredLineContribs(quote, { lockedOptionLines: stored, lockedResourceLines: [] }).optionLines;
  assert.deepEqual(out.map((l) => [l.acompteContribTtc, l.soldeContribTtc]), [[10, 30], [20, 70]]);
});

test('rule 85 (LINE: articleRowWhere) — one clause, one row: the first line, or the SAS-written one when asked, never both', () => {
  const { articleRowWhere } = require('../utils/lineRowTarget');
  const id = stayWithTwoSales();
  const [first, second] = rowsOf(id);
  db.prepare('UPDATE reservation_options SET sasArrivalOrigin = 1 WHERE lineId = ?').run(second.lineId);
  const touch = (opts) => {
    db.prepare('UPDATE reservation_options SET quantity = 1').run();
    db.prepare(`UPDATE reservation_options SET quantity = 9 WHERE ${articleRowWhere(db, 'reservation_options', 'optionId', opts)}`).run(id, bath);
    return rowsOf(id).filter((r) => r.quantity === 9).map((r) => r.lineId);
  };
  assert.deepEqual(touch({}), [first.lineId]);
  assert.deepEqual(touch({ sasFirst: true }), [second.lineId]);
});

test('rule 85 (LINE: reservationsModel) — the breakfast hour rewrites the moments of EVERY line of the breakfast option, each on its own row', () => {
  const breakfast = optionId('Petit déjeuner', 8, 'per_person_per_night');
  db.prepare("UPDATE options SET autoOptionType = 'breakfast', showsPlanningCard = 1 WHERE id = ?").run(breakfast);
  const id = stayWithTwoSales();
  const insert = db.prepare(`INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, cardOccurrences)
    VALUES (?, ?, 1, 8, 2, 'per_person_per_night', 16, ?)`);
  insert.run(id, breakfast, JSON.stringify([{ date: '2030-01-02', time: '08:00' }, { date: '2030-01-03', time: '08:00' }]));
  insert.run(id, breakfast, JSON.stringify([{ date: '2030-01-04', time: '08:30' }]));
  require('../models/reservationsModel').commitArrivalSas(id, { breakfastTime: '09:15' });
  const rows = db.prepare('SELECT cardOccurrences FROM reservation_options WHERE reservationId = ? AND optionId = ? ORDER BY lineId').all(id, breakfast)
    .map((r) => JSON.parse(r.cardOccurrences));
  assert.deepEqual(rows.map((list) => list.map((o) => [o.date, o.time])), [
    [['2030-01-02', '09:15'], ['2030-01-03', '09:15']],
    [['2030-01-04', '09:15']],
  ], 'two rows, two sets of dates kept, one hour');
});

test('rule 85 (LINE: reservationsModel) — offering an in-complement article reprices each of its rows on its own amount', () => {
  const id = stayWithTwoSales();
  db.prepare('UPDATE reservation_options SET inComplement = 1 WHERE reservationId = ? AND optionId = ?').run(id, bath);
  db.prepare('UPDATE reservations SET complementAmount = 130, complementPaid = 0 WHERE id = ?').run(id);
  const [first, second] = rowsOf(id).filter((r) => r.optionId === bath).map((r) => r.lineId);
  const refs = [{ kind: 'option', id: bath }, { kind: 'option', id: bath, lineId: second }];
  require('../models/reservationsModel').commitArrivalSas(id, { offeredExtras: refs });
  const rows = db.prepare('SELECT offered, totalPrice FROM reservation_options WHERE reservationId = ? AND optionId = ? ORDER BY lineId').all(id, bath);
  assert.deepEqual(rows.map((r) => r.offered), [1, 1]);
  assert.deepEqual(rows.map((r) => r.totalPrice), [0, 0]);
  require('../models/reservationsModel').commitArrivalSas(id, { offeredExtras: [] });
  const back = db.prepare('SELECT offered, totalPrice FROM reservation_options WHERE reservationId = ? AND optionId = ? ORDER BY lineId').all(id, bath);
  assert.deepEqual(back.map((r) => [r.offered, r.totalPrice]), [[0, 40], [0, 90]], 'each row gets ITS own price back, not the last row\'s over the first');
  assert.ok(first < second);
});

test('rule 85 (LINE: reservationsModel) — the floors and the units of a locked fiche are read per line', () => {
  const id = stayWithTwoSales();
  const [first, second] = rowsOf(id);
  const lines = require('../models/reservationsModel').readExtraLinesWithQuantity(id).filter((l) => l.optionId === bath);
  assert.deepEqual(lines.map((l) => [l.lineId, l.quantity, l.totalPrice, l.lineKey]), [
    [first.lineId, 1, 40, undefined],
    [second.lineId, 2, 90, `line:reservation_options:${second.lineId}`],
  ]);
});

test('rule 85 (LINE: planning option cards) — one card per LINE with its own moments; a tick lands on the line that holds the moment', () => {
  const meal = optionId('Repas', 25, 'per_person_per_night');
  db.prepare('UPDATE options SET showsPlanningCard = 1 WHERE id = ?').run(meal);
  const id = stayWithTwoSales();
  const insert = db.prepare(`INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, cardOccurrences)
    VALUES (?, ?, 1, 25, 1, 'per_person_per_night', 25, ?)`);
  insert.run(id, meal, JSON.stringify([{ date: '2030-02-01', time: '12:00' }]));
  insert.run(id, meal, JSON.stringify([{ date: '2030-02-01', time: '12:00' }, { date: '2030-02-02', time: '19:30' }]));
  const [firstMeal, secondMeal] = db.prepare('SELECT lineId FROM reservation_options WHERE reservationId = ? AND optionId = ? ORDER BY lineId').all(id, meal);
  const cards = require('../models/planningOptionCardsModel');
  const day = cards.cardsInRange({ from: '2030-02-01', to: '2030-02-02' });
  const mine = (date) => day[date].items.filter((i) => i.reservationId === id);
  assert.deepEqual(mine('2030-02-01').map((i) => i.lineId).sort(), [firstMeal.lineId, secondMeal.lineId].sort(), 'two cards at noon: one per line');
  assert.deepEqual(mine('2030-02-02').map((i) => i.lineId), [secondMeal.lineId]);
  assert.deepEqual(cards.setOccurrenceDone({ reservationId: id, optionId: meal, lineId: secondMeal.lineId, date: '2030-02-01', time: '12:00', done: true }), { ok: true, done: true });
  const done = (lineId) => JSON.parse(db.prepare('SELECT cardOccurrences FROM reservation_options WHERE lineId = ?').get(lineId).cardOccurrences).map((o) => Boolean(o.done));
  assert.deepEqual([done(firstMeal.lineId), done(secondMeal.lineId)], [[false], [true, false]], 'the other line is untouched');
  assert.deepEqual(cards.setOccurrenceDone({ reservationId: id, optionId: meal, date: '2030-02-02', time: '19:30', done: true }), { ok: true, done: true }, 'without a lineId: the first line that holds the moment');
  assert.deepEqual(done(secondMeal.lineId), [true, true]);
  assert.equal(cards.setOccurrenceDone({ reservationId: id, optionId: meal, lineId: firstMeal.lineId, date: '2030-02-02', time: '19:30', done: true }).error, 'OCCURRENCE_NOT_FOUND');
});

test('rule 85 (LINE: bookingLinesModel) — a save of two lines of one article gives each the identity of its own stored line; never two the same lineId', () => {
  const bookingLines = require('../models/bookingLinesModel').buildModel(db);
  const id = stayWithTwoSales();
  const [first, second] = rowsOf(id).filter((r) => r.optionId === bath);
  db.prepare("UPDATE reservation_options SET collectAt = 'departure', soldAt = '2030-01-01' WHERE lineId = ?").run(second.lineId);
  const line = (totalPrice, extra = {}) => ({ optionId: bath, quantity: 1, unitPrice: totalPrice, billedUnits: 1, priceType: 'per_stay', totalPrice, ...extra });
  bookingLines.replaceOptions(id, [line(41), line(91, { lineId: second.lineId })]);
  const after = db.prepare('SELECT lineId, totalPrice, collectAt FROM reservation_options WHERE reservationId = ? AND optionId = ? ORDER BY lineId').all(id, bath);
  assert.deepEqual(after.map((r) => [r.lineId, r.totalPrice]), [[first.lineId, 41], [second.lineId, 91]]);
  assert.equal(after[1].collectAt, 'departure', 'the sale columns follow the line that carried them');
  bookingLines.replaceOptions(id, [line(42), line(92)]);
  assert.deepEqual(db.prepare('SELECT lineId FROM reservation_options WHERE reservationId = ? AND optionId = ? ORDER BY lineId').all(id, bath).map((r) => r.lineId), [first.lineId, second.lineId], 'two posted lines without a name take the stored lines in order');
  const counts = bookingLines.getStoredTypedCounts(id);
  const dates = bookingLines.getStoredItemDates(id);
  assert.ok(counts[bath] && dates.options[bath], 'the stored counts and dates read every row');
});

test('rule 85 (LINE: stored dates and typed counts) — a value ANY line of the article stores is not re-judged', () => {
  const bookingLines = require('../models/bookingLinesModel').buildModel(db);
  const { refuseInvalidServedPersons } = require('../utils/lineInputBounds');
  const id = stayWithTwoSales();
  const [first, second] = rowsOf(id).filter((r) => r.optionId === bath);
  db.prepare("UPDATE reservation_options SET cardOccurrences = ?, cardPersons = 1 WHERE lineId = ?").run(JSON.stringify([{ date: '2029-01-01', time: '08:00' }]), first.lineId);
  db.prepare("UPDATE reservation_options SET cardOccurrences = ?, cardPersons = 40 WHERE lineId = ?").run(JSON.stringify([{ date: '2029-01-09', time: '08:00' }]), second.lineId);
  assert.deepEqual(bookingLines.getStoredItemDates(id).options[bath], ['2029-01-01', '2029-01-09']);
  const stored = bookingLines.getStoredTypedCounts(id);
  assert.equal(refuseInvalidServedPersons([{ optionId: bath, cardPersons: 40 }], stored), null, 'the second line\'s 40 is kept as stored');
  assert.ok(refuseInvalidServedPersons([{ optionId: bath, cardPersons: 0 }], stored), 'a new out-of-range count is still refused');
});

test('rule 85 (AGG: breakfastModel) — the breakfast card reads the UNION of the moments of every line of the breakfast option', () => {
  const breakfast = Number(db.prepare("SELECT id FROM options WHERE autoOptionType = 'breakfast'").get().id);
  const id = stayWithTwoSales(); // the stay of the other tests: 20 days ahead
  const insert = db.prepare(`INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, cardOccurrences)
    VALUES (?, ?, 1, 8, 1, 'per_person_per_night', 8, ?)`);
  insert.run(id, breakfast, JSON.stringify([{ date: '2030-05-01', time: '08:00' }]));
  insert.run(id, breakfast, JSON.stringify([{ date: '2030-05-02', time: '08:00' }]));
  db.prepare('UPDATE reservations SET startDate = ?, endDate = ? WHERE id = ?').run('2030-04-30', '2030-05-04', id);
  const days = require('../models/breakfastModel').breakfastByDate({ from: '2030-04-30', to: '2030-05-04' });
  const datesOfStay = Object.entries(days).filter(([, day]) => (day.items || day).some((i) => i.reservationId === id)).map(([date]) => date).sort();
  assert.deepEqual(datesOfStay, ['2030-05-01', '2030-05-02'], 'both lines\' mornings are served, not only the first row\'s');
});
