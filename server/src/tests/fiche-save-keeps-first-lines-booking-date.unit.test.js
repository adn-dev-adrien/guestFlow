// specs/pricing/pricing-components.md §3 rules 36, 37, 99, 100 and 97(b) (loop t2 D2-1) — a fiche save stamps only the lines IT wrote with its own date: the stay's
// first lines, written by the creation and left to the boot's reading, keep the booking's date, so a receipt dated between the booking and the save
// is frozen with them.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, beer, breakfast, todayIso, addDaysToIsoDate } = require('./saleRound1Fixtures');
const controller = require('../controllers/reservationsController');
const model = require('../models/reservationsModel');
const { toUpdateBody } = require('../utils/reservationUpdateBody');
const { localIsoDate } = require('../utils/localDate');
const { freezeStay } = require('../utils/receiptLineSplits');

const fake = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
const optionLines = (id) => db.prepare('SELECT optionId, soldAt, collectAt, articleRef FROM reservation_options WHERE reservationId = ? ORDER BY lineId').all(id);

function bookedTenDaysAgo(daysAhead) {
  const start = addDaysToIsoDate(todayIso(), daysAhead);
  const res = fake();
  controller.create({ user: { roles: ['admin'], email: 'x' }, query: {}, body: {
    clientId: 9701, propertyId: 9701, startDate: start, endDate: addDaysToIsoDate(start, 3), adults: 2, children: 0, platform: 'direct',
    options: [{ optionId: beer, quantity: 2 }],
  } }, res);
  assert.equal(res.statusCode < 300, true, JSON.stringify(res.body));
  const id = Number(res.body.id);
  db.prepare("UPDATE reservations SET createdAt = datetime('now', '-10 day'), readsSaleLines = 1 WHERE id = ?").run(id);
  return id;
}

async function save(id, patch) {
  const res = fake();
  await controller.update({ params: { id: String(id) }, query: {}, user: { roles: ['admin'] }, body: { ...toUpdateBody(model.getByIdWithDetails(id), new Set()), ...patch } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
}

const bookingDay = (id) => localIsoDate(new Date(`${db.prepare('SELECT createdAt FROM reservations WHERE id = ?').get(id).createdAt.replace(' ', 'T')}Z`));

test('D2-1 — a notes-only save leaves the first lines on the booking date; a receipt of yesterday is frozen with the option it paid', async () => {
  const id = bookedTenDaysAgo(40);
  await save(id, { notes: 'Arrivée vers 18 h' });
  const [line] = optionLines(id);
  assert.equal(String(line.soldAt), db.prepare('SELECT createdAt FROM reservations WHERE id = ?').get(id).createdAt, 'sold when the stay was booked, not at the save');
  assert.deepEqual([line.collectAt, line.articleRef], ['plan', `option:${beer}`]);
  const yesterday = addDaysToIsoDate(todayIso(), -1);
  freezeStay(db, db.prepare('SELECT * FROM reservations WHERE id = ?').get(id), [yesterday]);
  const frozen = JSON.parse(db.prepare('SELECT linesJson FROM receipt_line_splits WHERE reservationId = ? AND paidDate = ?').get(id, yesterday).linesJson);
  assert.ok(frozen.some((l) => l.kind === 'option'), JSON.stringify(frozen));
});

test('D2-1 — a save that adds a line stamps that line today and leaves the first line on the booking date', async () => {
  const id = bookedTenDaysAgo(60);
  await save(id, { options: [{ optionId: beer, quantity: 2, offered: false }, { optionId: breakfast, quantity: 1, offered: false }] });
  const lines = optionLines(id);
  assert.equal(lines.length, 2);
  const day = (soldAt) => localIsoDate(new Date(String(soldAt).includes('T') ? soldAt : `${String(soldAt).replace(' ', 'T')}Z`));
  assert.deepEqual(lines.map((l) => [l.optionId, day(l.soldAt)]), [[beer, bookingDay(id)], [breakfast, todayIso()]]);
});
