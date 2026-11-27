// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rule 29 (K4, K9) — one figure per booking. The price path of a booking is a fact stored on it (`engineRated`): every booking kind
// (an outside session new or of before, a lodging with no stay), unmoved, notes-only saved or moved, on and off the slot grid, a week day, a weekend day and the eve of a holiday, is
// priced identically by the fiche preview, the stored total, the visit document's session line and the invoice basis. A row of before keeps its figure through a save that does not move it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const v = require('./visitFixture');
const { FAR_YEAR } = require('../../../tests/farYearFixture');

const { db, bookings, visits, row } = v;
const resourceId = Number(db.prepare(`INSERT INTO resources (name, quantity, price, priceType, turnoverMinutes, minimumUsageMinutes, slotDuration, isComplex, openTime, closeTime,
  showsPlanningCard, hourlyEveningStart, hourlyEveningRate, hourlyNextDayRate, hourlyNextEveningRate, hourlyExternalDayRate, hourlyExternalEveningRate, hourlyExternalNextDayRate, hourlyExternalNextEveningRate,
  hourlyExternalWeekendDayRate, hourlyExternalWeekendEveningRate, hourlyExternalWeekendNextDayRate, hourlyExternalWeekendNextEveningRate, sellableExternally)
  VALUES ('Bain 60', 5, 30, 'per_hour', 0, 60, 60, 0, '11:00', '22:00', 1, '20:00', 50, 30, 50, 50, 70, 45, 63, 70, 90, 60, 80, 1)`).run().lastInsertRowid);
const propertyId = Number(db.prepare("INSERT INTO properties (name) VALUES ('Gîte')").run().lastInsertRowid);

const dayOf = (offset) => new Date(Date.parse(`${FAR_YEAR}-03-01T12:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
const weekday = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();
const find = (wanted) => { for (let i = 0; i < 14; i += 1) if (weekday(dayOf(i)) === wanted) return dayOf(i); return null; };
const DAYS = { week: find(3), saturday: find(6), sunday: find(0), friday: find(5), holidayEve: `${FAR_YEAR}-07-13` }; // 14 July is a public holiday: its eve is weekend from the evening
const SESSIONS = [['13:00', '14:00'], ['13:00', '15:00'], ['13:00', '14:30'], ['20:30', '21:30'], ['19:30', '21:00']];
const cents = (euros) => Math.round(Number(euros) * 100);

function figuresOf(id, { visit }) {
  const stored = row(id);
  const preview = bookings.priceBooking({
    resourceId, bookingId: id, date: stored.date, startTime: stored.startTime, endTime: stored.endTime, propertyId: stored.propertyId,
  });
  assert.ok(!preview.error, JSON.stringify(preview));
  const basis = bookings.invoiceBasis(id);
  const figures = { stored: cents(stored.totalPrice), preview: cents(preview.total), invoice: cents(basis.breakdown.total) };
  if (visit) {
    const saleId = visits.ensureDocument(row(id), { actor: 'user:1', stop: (refusal) => { throw new Error(JSON.stringify(refusal)); } });
    const line = require('../../../utils/standaloneSale').documentOf(saleId).lines.find((l) => String(l.fulfilmentRef || '').startsWith('hourly-slot:'));
    figures.visit = line.totalCents;
  }
  return figures;
}
const agree = (figures, label) => {
  const values = Object.values(figures);
  assert.ok(values.every((value) => value === values[0]), `${label}: ${JSON.stringify(figures)}`);
};

const make = (kind, date, startTime, endTime) => {
  const body = { resourceId, date, startTime, endTime, clientName: 'Dehors' };
  if (kind === 'lodging no stay') body.propertyId = propertyId;
  const made = bookings.createBooking(body);
  assert.ok(made.ok, JSON.stringify(made));
  const id = Number(made.id);
  if (kind === 'outside of before') {
    // Priced the way the release before priced it (the guests' flat rate off the grid), without the engine fact.
    const { priceBookingLines } = require('../bookingPricing');
    const legacy = priceBookingLines({ resource: db.prepare('SELECT * FROM resources WHERE id = ?').get(resourceId), startTime, endTime, external: true, engineRated: false, lodging: false, judgeBands: false });
    db.prepare('UPDATE resource_bookings SET engineRated = NULL, totalPrice = ? WHERE id = ?').run(legacy.total, id);
  }
  return id;
};

test.afterEach(() => { db.prepare('DELETE FROM resource_bookings').run(); });

const KINDS = ['outside new', 'outside of before', 'lodging no stay'];
for (const kind of KINDS) {
  for (const [label, date] of Object.entries(DAYS)) {
    for (const [startTime, endTime] of SESSIONS) {
      test(`${kind}, ${label} ${startTime}-${endTime}: preview, stored total, invoice basis${kind === 'lodging no stay' ? '' : ' and visit session line are one figure'}`, () => {
        const id = make(kind, date, startTime, endTime);
        const before = figuresOf(id, { visit: kind !== 'lodging no stay' });
        agree(before, 'unmoved');
        const saved = bookings.update(id, { notes: 'a note' });
        assert.ok(saved.ok, JSON.stringify(saved));
        assert.equal(cents(row(id).totalPrice), before.stored, 'a save that moves nothing keeps the figure');
        assert.equal(row(id).engineRated === 1, kind !== 'outside of before', 'the fact is kept by a save that moves nothing');
        // moved: one slot later (still inside the opening hours) — now on the engine path whatever it was.
        const moved = bookings.update(id, { startTime: '15:00', endTime: '16:00' });
        assert.ok(moved.ok, JSON.stringify(moved));
        if (kind !== 'lodging no stay') assert.equal(row(id).engineRated, 1);
        agree(figuresOf(id, { visit: false }), 'moved');
      });
    }
  }
}

test('an outside booking of before keeps its stored figure, off the grid, through a notes-only save (production booking #6: 45 €)', () => {
  const date = DAYS.sunday;
  const id = Number(db.prepare(`INSERT INTO resource_bookings (resourceId, clientName, date, startTime, endTime, totalPrice, paid, offeredMinutes, freeHourAtDayRate)
    VALUES (?, 'Legacy', ?, '13:00', '14:30', 45, 0, 0, NULL)`).run(resourceId, date).lastInsertRowid);
  assert.equal(bookings.priceBooking({ resourceId, bookingId: id, date, startTime: '13:00', endTime: '14:30' }).total, 45);
  assert.ok(bookings.update(id, { notes: 'x' }).ok);
  assert.equal(row(id).totalPrice, 45);
  assert.equal(bookings.invoiceBasis(id).breakdown.total, 45);
});

test('a stored pair whose end does not follow its start prices 0 € and never throws, on the preview and the save (rule 23 exemption)', () => {
  db.prepare('UPDATE resources SET minimumUsageMinutes = 0 WHERE id = ?').run(resourceId);
  try {
    const id = Number(db.prepare(`INSERT INTO resource_bookings (resourceId, clientName, date, startTime, endTime, totalPrice, paid, offeredMinutes, freeHourAtDayRate, engineRated)
      VALUES (?, 'Odd', ?, '15:00', '15:00', 0, 0, 0, 1, 1)`).run(resourceId, DAYS.week).lastInsertRowid);
    const preview = bookings.priceBooking({ resourceId, bookingId: id, date: DAYS.week, startTime: '15:00', endTime: '15:00' });
    assert.equal(preview.total, 0);
    assert.ok(bookings.update(id, { notes: 'x' }).ok);
    assert.equal(row(id).totalPrice, 0);
    const pure = require('../bookingPricing').priceBookingLines({
      resource: db.prepare('SELECT * FROM resources WHERE id = ?').get(resourceId), startTime: '15:00', endTime: '14:00', external: true, date: DAYS.week,
    });
    assert.equal(pure.total, 0);
  } finally {
    db.prepare('UPDATE resources SET minimumUsageMinutes = 60 WHERE id = ?').run(resourceId);
  }
});
