// specs/reservations/platform-stays-always-saveable.md — a stay a platform sold is always saveable: the stay-shape rules
// (minimum, maximum, changeover days) and the guest capacity never block it; a save that moves neither the dates, the
// property nor the party never re-judges them, whatever the channel. Overlap, beds, resources stay refused.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FAR_YEAR } = require('./farYearFixture');
const { judgeStayRules, quoteWithJudgement, stayMovement } = require('../utils/stayRuleJudgement');

const SPEC = 'specs/reservations/platform-stays-always-saveable.md';

// ---------------------------------------------------------------- pure judgement

const ALL_MOVED = { datesMoved: true, propertyMoved: true, partyMoved: true };
const NOTHING_MOVED = { datesMoved: false, propertyMoved: false, partyMoved: false };
const BREACHING_QUOTE = {
  nights: 3, requiredMinNights: 4, minNightsBreached: true,
  minNightsRules: [{ label: 'Haute', minNights: 2 }, { label: 'Très haute', minNights: 4 }],
  nightlyBreakdown: [
    { date: `${FAR_YEAR}-07-08`, seasonLabel: 'Haute' }, { date: `${FAR_YEAR}-07-09`, seasonLabel: 'Haute' },
    { date: `${FAR_YEAR}-07-10`, seasonLabel: 'Très haute' },
  ],
  requiredMaxNights: 2, maxNightsBreached: true,
  changeoverBreached: true, changeoverArrivalBreached: true, changeoverDepartureBreached: true,
  requiredArrivalDayLabel: 'samedi', requiredDepartureDayLabel: 'dimanche',
};

test(`${SPEC} rule 1 — every channel but direct is a platform stay, Lodgify included`, () => {
  for (const platform of ['Booking', 'Airbnb', 'Lodgify', 'Gîtes de France']) {
    assert.equal(judgeStayRules({ quote: BREACHING_QUOTE, platform, movement: ALL_MOVED }).platformStay, true, platform);
  }
  assert.equal(judgeStayRules({ quote: BREACHING_QUOTE, platform: 'direct', movement: ALL_MOVED }).platformStay, false);
  assert.equal(judgeStayRules({ quote: BREACHING_QUOTE, platform: undefined, movement: ALL_MOVED }).platformStay, false);
});

test(`${SPEC} rule 2 — a platform stay is never blocked by the minimum, the maximum or the changeover days`, () => {
  const j = judgeStayRules({ quote: BREACHING_QUOTE, platform: 'Booking', movement: ALL_MOVED });
  assert.deepEqual(j.blocks, { minNights: false, maxNights: false, changeover: false });
  const reported = quoteWithJudgement(BREACHING_QUOTE, j);
  assert.deepEqual([reported.minNightsBreached, reported.maxNightsBreached, reported.changeoverBreached], [false, false, false]);
});

test(`${SPEC} rule 3 — a platform stay never judges the capacity, and the quote says so`, () => {
  const j = judgeStayRules({ quote: BREACHING_QUOTE, platform: 'Booking', movement: ALL_MOVED });
  assert.equal(j.capacityJudged, false);
  assert.equal(quoteWithJudgement(BREACHING_QUOTE, j).capacityJudged, false);
});

test(`${SPEC} rule 5 — the notes are worded for each breach, and empty when there is none`, () => {
  const j = judgeStayRules({
    quote: BREACHING_QUOTE, platform: 'Booking', movement: NOTHING_MOVED,
    capacityBreach: { message: 'Le nombre de personnes dépasse la capacité du logement (voyageurs: 5/4).' },
  });
  assert.equal(j.notes[0], 'Booking a vendu 3 nuits ; ces dates en demandent 4 (« Très haute » dès le 10/07). À corriger sur Booking pour les prochaines réservations.');
  assert.match(j.notes[1], /^Booking a vendu 3 nuits ; ces dates en autorisent 2 au plus\./);
  assert.match(j.notes[2], /^Booking a vendu ces dates ; elles imposent une arrivée le samedi et un départ le dimanche\./);
  assert.match(j.notes[3], /voyageurs: 5\/4\)\. À corriger sur Booking/);
  const clean = judgeStayRules({ quote: { nights: 3, requiredMinNights: 3 }, platform: 'Booking', movement: ALL_MOVED });
  assert.deepEqual(clean.notes, []);
});

test(`${SPEC} rule 5 — a stay that starts in the strictest season names the season without a date`, () => {
  const quote = { ...BREACHING_QUOTE, maxNightsBreached: false, changeoverBreached: false, nights: 1,
    nightlyBreakdown: [{ date: `${FAR_YEAR}-07-10`, seasonLabel: 'Très haute' }] };
  const { notes } = judgeStayRules({ quote, platform: 'Booking', movement: ALL_MOVED });
  assert.equal(notes[0], 'Booking a vendu 1 nuit ; ces dates en demandent 4 (« Très haute »). À corriger sur Booking pour les prochaines réservations.');
});

test(`${SPEC} rules 6, 7 — a direct stay that moves keeps every guard and carries no note`, () => {
  const j = judgeStayRules({ quote: BREACHING_QUOTE, platform: 'direct', movement: { ...NOTHING_MOVED, datesMoved: true } });
  assert.deepEqual(j.blocks, { minNights: true, maxNights: true, changeover: true });
  assert.deepEqual(j.notes, []);
  assert.equal(judgeStayRules({ quote: BREACHING_QUOTE, platform: 'direct', movement: { ...NOTHING_MOVED, partyMoved: true } }).capacityJudged, true);
  assert.equal(judgeStayRules({ quote: BREACHING_QUOTE, platform: 'direct', movement: { ...NOTHING_MOVED, datesMoved: true } }).capacityJudged, false,
    'dates alone never re-judged the capacity (edit-reservation-blocked-by-overlap)');
});

test(`${SPEC} rule 8 — a direct save that moves neither dates, property nor party judges nothing`, () => {
  const j = judgeStayRules({ quote: BREACHING_QUOTE, platform: 'direct', movement: NOTHING_MOVED });
  assert.deepEqual(j.blocks, { minNights: false, maxNights: false, changeover: false });
  assert.equal(j.capacityJudged, false);
});

test(`${SPEC} rule 8 — « moved » is read against the stored row`, () => {
  const stored = { propertyId: 1, startDate: '2030-01-01', endDate: '2030-01-04', adults: 2, children: 0, teens: 0, babies: 0 };
  assert.deepEqual(stayMovement(stored, { ...stored, adults: '2' }), NOTHING_MOVED);
  assert.equal(stayMovement(stored, { ...stored, endDate: '2030-01-05' }).datesMoved, true);
  assert.equal(stayMovement(stored, { ...stored, propertyId: 2 }).propertyMoved, true);
  assert.equal(stayMovement(stored, { ...stored, babies: 1 }).partyMoved, true);
  assert.deepEqual(stayMovement(null, stored), ALL_MOVED, 'a creation moves everything');
});

// ---------------------------------------------------------------- the controller, on a real database

const db = require('../database');
const controller = require('../controllers/reservationsController');

const ADMIN = { role: 'admin', roles: ['admin'] };
function reply() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}
const call = async (fn, req) => { const r = reply(); await fn({ user: ADMIN, headers: {}, query: {}, ...req }, r); return r; };

// The first Monday of September: a Monday → Wednesday stay breaks Saturday changeovers.
const monday = (() => { const d = new Date(Date.UTC(FAR_YEAR, 8, 1)); while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1); return d; })();
const iso = (d, plus = 0) => new Date(d.getTime() + plus * 86400000).toISOString().slice(0, 10);

const propertyId = Number(db.prepare("INSERT INTO properties (name, maxGuests, singleBeds, doubleBeds, maxBabies) VALUES ('Gîte', 2, 1, 0, 1)").run().lastInsertRowid);
const otherPropertyId = Number(db.prepare("INSERT INTO properties (name, maxGuests, singleBeds, doubleBeds, maxBabies) VALUES ('Lodge', 2, 1, 0, 1)").run().lastInsertRowid);
const rangeOf = (start, end) => JSON.stringify([{ startDate: start, endDate: end }]);
function season(pid, label, extra, ranges) {
  db.prepare(`INSERT INTO pricing_rules (propertyId, label, pricePerNight, dateRanges, minNights, maxNights, changeoverArrival, changeoverDeparture)
              VALUES (?, ?, 100, ?, ?, ?, ?, ?)`).run(pid, label, ranges, extra.min || 1, extra.max || null, extra.arrival ?? null, extra.departure ?? null);
}
season(propertyId, 'Standard', {}, rangeOf(`${FAR_YEAR}-10-01`, `${FAR_YEAR}-12-31`));
season(propertyId, 'Haute', { min: 2 }, rangeOf(`${FAR_YEAR}-07-01`, `${FAR_YEAR}-07-09`));
season(propertyId, 'Très haute', { min: 4 }, rangeOf(`${FAR_YEAR}-07-10`, `${FAR_YEAR}-07-31`));
season(propertyId, 'Courte', { max: 3 }, rangeOf(`${FAR_YEAR}-08-01`, `${FAR_YEAR}-08-31`));
season(propertyId, 'Samedi', { arrival: 6, departure: 6 }, rangeOf(`${FAR_YEAR}-09-01`, `${FAR_YEAR}-09-30`));
season(otherPropertyId, 'Standard', {}, '[]');
test.afterEach(() => { db.prepare('DELETE FROM reservations').run(); });
const clientId = Number(db.prepare("INSERT INTO clients (firstName, lastName) VALUES ('Camille', 'Revue')").run().lastInsertRowid);
const bedLinen = Number(db.prepare("INSERT INTO options (title, priceType, price, countsAsBedLinen) VALUES ('Linge de lit', 'per_stay', 0, 1)").run().lastInsertRowid);
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (?, ?)').run(propertyId, bedLinen);

const body = (platform, start, end, extra = {}) => ({
  propertyId, clientId, platform, startDate: start, endDate: end, checkInTime: '16:00', checkOutTime: '10:00',
  adults: 2, children: 0, teens: 0, babies: 0, singleBeds: 0, doubleBeds: 0, babyBeds: 0, depositDisabled: 1, options: [], ...extra,
});
const quoteBody = (b, extra = {}) => ({ ...b, selectedOptions: [], customOptions: [], selectedResources: [], ...extra });

const JULY_SHORT = [`${FAR_YEAR}-07-08`, `${FAR_YEAR}-07-11`]; // 3 nights touching the 10/07 « Très haute » minimum of 4
const AUG_LONG = [`${FAR_YEAR}-08-03`, `${FAR_YEAR}-08-08`]; // 5 nights, maximum 3
const SEPT_OFF_DAY = [iso(monday), iso(monday, 2)]; // Monday → Wednesday, Saturday changeovers
const quiet = [`${FAR_YEAR}-10-05`, `${FAR_YEAR}-10-08`]; // no rule at all

test(`${SPEC} rule 2 — a platform stay under the minimum, over the maximum, off the changeover day is created without force`, async () => {
  for (const [start, end] of [JULY_SHORT, AUG_LONG, SEPT_OFF_DAY]) {
    const r = await call(controller.create, { body: body('Booking', start, end) });
    assert.equal(r.statusCode < 300, true, `${start}: ${JSON.stringify(r.body)}`);
    assert.ok(r.body.id);
    db.prepare('DELETE FROM reservations WHERE id = ?').run(r.body.id);
  }
});

test(`${SPEC} rule 2 — the same stays are refused for a direct stay (rule 7), with the force flags still lifting them`, async () => {
  for (const [[start, end], code] of [[JULY_SHORT, 'MIN_NIGHTS'], [AUG_LONG, 'MAX_NIGHTS'], [SEPT_OFF_DAY, 'CHANGEOVER']]) {
    const refused = await call(controller.create, { body: body('direct', start, end) });
    assert.equal(refused.statusCode, 409, start);
    assert.equal(refused.body.code, code);
    const forced = await call(controller.create, {
      body: body('direct', start, end, { forceMinNights: true, forceMaxNights: true, forceChangeover: true }),
    });
    assert.equal(forced.statusCode < 300, true, JSON.stringify(forced.body));
    db.prepare('DELETE FROM reservations WHERE id = ?').run(forced.body.id);
  }
});

test(`${SPEC} rule 2 — a platform stay is edited into a period asking for more nights, saved and noted`, async () => {
  const created = await call(controller.create, { body: body('Booking', ...quiet) });
  const id = created.body.id;
  const moved = body('Booking', ...JULY_SHORT, { reservationId: id });
  const saved = await call(controller.update, { params: { id: String(id) }, body: moved });
  assert.equal(saved.statusCode < 300, true, JSON.stringify(saved.body));
  assert.equal(db.prepare('SELECT startDate FROM reservations WHERE id = ?').get(id).startDate, JULY_SHORT[0]);
  const quote = await call(controller.calculatePrice, { body: quoteBody(moved, { reservationId: id }) });
  assert.equal(quote.body.minNightsBreached, false, 'the fiche opens no dialog');
  assert.equal(quote.body.stayRuleNotes.length, 1);
  assert.equal(quote.body.stayRuleNotes[0], `Booking a vendu 3 nuits ; ces dates en demandent 4 (« Très haute » dès le 10/07). À corriger sur Booking pour les prochaines réservations.`);
  db.prepare('DELETE FROM reservations WHERE id = ?').run(id);
});

test(`${SPEC} rule 3 — a platform stay above capacity is saved without forceCapacity, and its quote does not judge capacity`, async () => {
  const over = body('Booking', ...quiet, { adults: 4 });
  const r = await call(controller.create, { body: over });
  assert.equal(r.statusCode < 300, true, JSON.stringify(r.body));
  const quote = await call(controller.calculatePrice, { body: quoteBody(over, { reservationId: r.body.id }) });
  assert.equal(quote.body.capacityJudged, false);
  assert.match(quote.body.stayRuleNotes[0], /voyageurs: 4\/2/);
  db.prepare('DELETE FROM reservations WHERE id = ?').run(r.body.id);

  const direct = await call(controller.create, { body: body('direct', ...quiet, { adults: 4 }) });
  assert.equal(direct.statusCode, 400, 'a direct stay still needs forceCapacity');
  const directQuote = await call(controller.calculatePrice, { body: quoteBody(body('direct', ...quiet, { adults: 4 })) });
  assert.equal(directQuote.body.capacityJudged, true);
});

test(`${SPEC} rule 4 — a platform stay that overlaps another stay is still refused`, async () => {
  const first = await call(controller.create, { body: body('direct', ...quiet) });
  const clash = await call(controller.create, { body: body('Booking', quiet[0], iso(new Date(`${quiet[1]}T00:00:00Z`), 1)) });
  assert.equal(clash.statusCode, 409, JSON.stringify(clash.body));
  db.prepare('DELETE FROM reservations WHERE id = ?').run(first.body.id);
});

test(`${SPEC} rule 4 — a platform stay whose beds exceed the property's is still refused, even above capacity`, async () => {
  const r = await call(controller.create, {
    body: body('Booking', ...quiet, { adults: 4, singleBeds: 5, options: [{ optionId: bedLinen, quantity: 1 }] }),
  });
  assert.equal(r.statusCode, 400, JSON.stringify(r.body));
  assert.match(r.body.error, /lits simples/);
});

test(`${SPEC} rule 7 — a direct stay that moves its dates is refused with MIN_NIGHTS on update`, async () => {
  const created = await call(controller.create, { body: body('direct', ...quiet) });
  const id = created.body.id;
  const refused = await call(controller.update, { params: { id: String(id) }, body: body('direct', ...JULY_SHORT, { reservationId: id }) });
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.body.code, 'MIN_NIGHTS');
  db.prepare('DELETE FROM reservations WHERE id = ?').run(id);
});

test(`${SPEC} rule 8 — a direct stay already under the minimum is saved by a finance-only edit, with no breach in its quote`, async () => {
  const forced = await call(controller.create, { body: body('direct', ...JULY_SHORT, { forceMinNights: true }) });
  const id = forced.body.id;
  const edit = body('direct', ...JULY_SHORT, { reservationId: id, customPrice: 450 });
  const saved = await call(controller.update, { params: { id: String(id) }, body: edit });
  assert.equal(saved.statusCode < 300, true, JSON.stringify(saved.body));
  const quote = await call(controller.calculatePrice, { body: quoteBody(edit, { reservationId: id }) });
  assert.equal(quote.body.minNightsBreached, false);
  assert.equal(quote.body.capacityJudged, false);
  assert.deepEqual(quote.body.stayRuleNotes, [], 'a direct stay carries no note');
  db.prepare('DELETE FROM reservations WHERE id = ?').run(id);
});

test(`${SPEC} rule 8 — a direct stay under the minimum whose dates move is judged again`, async () => {
  const forced = await call(controller.create, { body: body('direct', ...JULY_SHORT, { forceMinNights: true }) });
  const id = forced.body.id;
  const moved = body('direct', `${FAR_YEAR}-07-09`, `${FAR_YEAR}-07-11`, { reservationId: id });
  const quote = await call(controller.calculatePrice, { body: quoteBody(moved, { reservationId: id }) });
  assert.equal(quote.body.minNightsBreached, true);
  const refused = await call(controller.update, { params: { id: String(id) }, body: moved });
  assert.equal(refused.statusCode, 409);
  db.prepare('DELETE FROM reservations WHERE id = ?').run(id);
});

test(`${SPEC} rule 11 — a stay switched from a platform to direct falls under the guards again at its next save`, async () => {
  const created = await call(controller.create, { body: body('Booking', ...JULY_SHORT) });
  const id = created.body.id;
  const switched = body('direct', `${FAR_YEAR}-07-09`, `${FAR_YEAR}-07-11`, { reservationId: id });
  const refused = await call(controller.update, { params: { id: String(id) }, body: switched });
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.body.code, 'MIN_NIGHTS');
  db.prepare('DELETE FROM reservations WHERE id = ?').run(id);
});
