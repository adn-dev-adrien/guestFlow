// specs/reservations-backend-mvc.md rule 13 (second reading, option occurrences and hourly sessions) — an option occurrence or an hourly session is dated on one of the
// stay's days, arrival to departure morning inclusive, or it is refused with « Date hors du séjour. »
// (`INVALID_STAY_DATES`, field `cardOccurrences` / `sessions`) before any pricing or write: on the price
// preview, the reservation create and update, and the devis create and update. A date the line already
// stores is not re-judged. Review of PR #938, F1: 1900-01-01, 9999-12-31 and 2099-02-30 were billed and stored.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./reservationSaveFixture');
const devisController = require('../controllers/devisController');
const { addDaysToIsoDate } = require('../utils/devisHelpers');
const { stayItemDatesRefusal, ITEM_OUTSIDE_STAY_MESSAGE } = require('../utils/stayDates');

const START = f.inDays(270);
const END = f.inDays(273);
const IMPOSSIBLE = `${Number(START.slice(0, 4)) + 1}-02-30`;
const OUTSIDE = ['1900-01-01', '9999-12-31', IMPOSSIBLE, addDaysToIsoDate(START, -1), addDaysToIsoDate(END, 1)];

const occurrence = (date) => [{ optionId: 50, quantity: 1, cardOccurrences: [{ date, time: '08:00' }] }];
const session = (date) => [{ resourceId: 70, quantity: 1, sessions: [{ date, start: '10:00', end: '11:00' }] }];
const refusal = (field) => ({ status: 400, error: ITEM_OUTSIDE_STAY_MESSAGE, code: 'INVALID_STAY_DATES', field });
const bodyOf = (field) => ({ error: ITEM_OUTSIDE_STAY_MESSAGE, code: 'INVALID_STAY_DATES', field });

function call(handler, req) {
  const res = f.respond();
  const out = handler({ user: f.ADMIN, params: {}, query: {}, ...req }, res);
  return out && typeof out.then === 'function' ? out.then(() => res) : res;
}

const count = (sql, ...args) => f.db.prepare(sql).get(...args).n;

test.before(() => {
  f.seed();
  f.db.prepare("INSERT INTO resources (id, name, quantity, price) VALUES (70, 'Bain test', 1, 20)").run();
});

test('rule 13: the helper refuses a date outside the stay or not a real day, accepts arrival to departure morning', () => {
  assert.equal(ITEM_OUTSIDE_STAY_MESSAGE, 'Date hors du séjour.');
  const judge = (over) => stayItemDatesRefusal({ startDate: START, endDate: END, ...over });
  for (const date of OUTSIDE) {
    assert.deepEqual(judge({ options: occurrence(date) }), refusal('cardOccurrences'), date);
    assert.deepEqual(judge({ resources: session(date) }), refusal('sessions'), date);
  }
  for (const date of [START, addDaysToIsoDate(START, 1), END]) {
    assert.equal(judge({ options: occurrence(date), resources: session(date) }), null, date);
  }
  assert.equal(judge({ options: [{ optionId: 50, cardOccurrences: JSON.stringify([{ date: END }]) }] }), null);
  assert.deepEqual(judge({ options: [{ optionId: 50, cardOccurrences: JSON.stringify([{ date: '1900-01-01' }]) }] }), refusal('cardOccurrences'));
  assert.equal(judge({ options: [{ optionId: 50 }], resources: [{ resourceId: 70 }] }), null);
  assert.equal(judge({}), null);
});

test('rule 13: a date the line already stores is kept, the same date on another line is not', () => {
  const stored = { options: { 50: ['1900-01-01'] }, resources: { 70: [IMPOSSIBLE] } };
  const judge = (over) => stayItemDatesRefusal({ startDate: START, endDate: END, stored, ...over });
  assert.equal(judge({ options: occurrence('1900-01-01'), resources: session(IMPOSSIBLE) }), null);
  assert.deepEqual(judge({ options: [{ optionId: 51, cardOccurrences: [{ date: '1900-01-01' }] }] }), refusal('cardOccurrences'));
  assert.deepEqual(judge({ resources: session('1900-01-01') }), refusal('sessions'));
});

test('rule 13: calculate-price refuses an occurrence or a session outside the stay before pricing it', async () => {
  for (const date of OUTSIDE) {
    const options = await call(f.controller.calculatePrice, { body: f.stayBody({ selectedOptions: occurrence(date) }) });
    assert.equal(options.statusCode, 400, date);
    assert.deepEqual(options.body, bodyOf('cardOccurrences'));
    const resources = await call(f.controller.calculatePrice, { body: f.stayBody({ selectedResources: session(date) }) });
    assert.deepEqual([resources.statusCode, resources.body], [400, bodyOf('sessions')], date);
  }
  const ok = await call(f.controller.calculatePrice, { body: f.stayBody({ selectedOptions: occurrence(END), selectedResources: session(START) }) });
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
});

test('rule 13: POST /reservations refuses an occurrence or a session outside the stay and writes nothing', () => {
  const n = count('SELECT COUNT(*) AS n FROM reservations');
  const options = f.create(f.stayBody({ options: occurrence('1900-01-01') }));
  assert.deepEqual([options.statusCode, options.body], [400, bodyOf('cardOccurrences')]);
  const resources = f.create(f.stayBody({ resources: session(IMPOSSIBLE) }));
  assert.deepEqual([resources.statusCode, resources.body], [400, bodyOf('sessions')]);
  assert.equal(count('SELECT COUNT(*) AS n FROM reservations'), n);
  const ok = f.create(f.stayBody({ options: occurrence(END), resources: session(START) }));
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
});

test('rule 13: PUT /reservations/:id refuses a new date outside the stay; an occurrence stored outside it is kept on a re-save', async () => {
  const id = f.createStay({ startDate: f.inDays(300), endDate: f.inDays(303), options: occurrence(f.inDays(301)) });
  const refused = await f.save(id, { options: occurrence('1899-05-05') });
  assert.deepEqual([refused.statusCode, refused.body], [400, bodyOf('cardOccurrences')]);
  assert.doesNotMatch(String(f.db.prepare('SELECT cardOccurrences FROM reservation_options WHERE reservationId = ? AND optionId = 50').get(id).cardOccurrences), /1899/);
  const sessions = await f.save(id, { resources: session(f.inDays(310)) });
  assert.deepEqual([sessions.statusCode, sessions.body], [400, bodyOf('sessions')]);

  const legacy = f.inDays(250);
  f.db.prepare('UPDATE reservation_options SET cardOccurrences = ? WHERE reservationId = ? AND optionId = 50').run(JSON.stringify([{ date: legacy, time: '08:00' }]), id);
  const kept = await f.save(id, { notes: 'Relue', options: occurrence(legacy) });
  assert.equal(kept.statusCode, 200, JSON.stringify(kept.body));
  const quoted = await call(f.controller.calculatePrice, { body: f.stayBody({ reservationId: id, startDate: f.inDays(300), endDate: f.inDays(303), selectedOptions: occurrence(legacy) }) });
  assert.equal(quoted.statusCode, 200, JSON.stringify(quoted.body));
});

test('rule 13: POST and PUT /devis refuse an occurrence or a session outside the stay', () => {
  const n = count("SELECT COUNT(*) AS n FROM reservations WHERE kind = 'devis'");
  const refused = call(devisController.create, { body: f.stayBody({ selectedOptions: occurrence('1900-01-01') }) });
  assert.equal(refused.statusCode, 400, JSON.stringify(refused.body));
  assert.deepEqual(refused.body, bodyOf('cardOccurrences'));
  assert.equal(count("SELECT COUNT(*) AS n FROM reservations WHERE kind = 'devis'"), n);
  const created = call(devisController.create, { body: f.stayBody({ startDate: f.inDays(320), endDate: f.inDays(323), selectedOptions: occurrence(f.inDays(323)) }) });
  assert.equal(created.statusCode, 201, JSON.stringify(created.body));
  const update = (over) => call(devisController.update, { params: { id: String(created.body.id) }, body: f.stayBody({ startDate: f.inDays(320), endDate: f.inDays(323), ...over }) });
  assert.deepEqual(update({ selectedResources: session('9999-12-31') }).body, bodyOf('sessions'));
  assert.deepEqual(update({ selectedOptions: occurrence(f.inDays(324)) }).body, bodyOf('cardOccurrences'));
  assert.equal(update({ selectedOptions: occurrence(f.inDays(320)) }).statusCode, 200);
});

test('rule 13: an impossible day lying between the arrival and the departure is refused (stay over the end of February)', async () => {
  const year = Number(START.slice(0, 4)) + 1;
  const feb = { startDate: `${year}-02-26`, endDate: `${year}-03-02` };
  const inside = `${year}-02-30`;
  assert.ok(inside > feb.startDate && inside < feb.endDate);
  assert.deepEqual(stayItemDatesRefusal({ ...feb, options: occurrence(inside) }), refusal('cardOccurrences'));
  assert.deepEqual(stayItemDatesRefusal({ ...feb, resources: session(inside) }), refusal('sessions'));
  const options = await call(f.controller.calculatePrice, { body: f.stayBody({ ...feb, selectedOptions: occurrence(inside) }) });
  assert.deepEqual([options.statusCode, options.body], [400, bodyOf('cardOccurrences')]);
  const resources = await call(f.controller.calculatePrice, { body: f.stayBody({ ...feb, selectedResources: session(inside) }) });
  assert.deepEqual([resources.statusCode, resources.body], [400, bodyOf('sessions')]);
});

test('rule 13: an occurrence carrying a time after its day is judged on the day', async () => {
  assert.equal(stayItemDatesRefusal({ startDate: START, endDate: END, options: occurrence(`${START}T09:00`) }), null);
  assert.deepEqual(stayItemDatesRefusal({ startDate: START, endDate: END, options: occurrence(`${addDaysToIsoDate(END, 1)}T09:00`) }), refusal('cardOccurrences'));
  const ok = await call(f.controller.calculatePrice, { body: f.stayBody({ selectedOptions: occurrence(`${START}T09:00`) }) });
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
});

test('rule 13: PUT /reservations/:id keeps a session stored outside the stay on a re-save', async () => {
  const id = f.createStay({ startDate: f.inDays(340), endDate: f.inDays(343), resources: session(f.inDays(341)) });
  const legacy = f.inDays(240);
  f.db.prepare('UPDATE reservation_resources SET sessions = ? WHERE reservationId = ? AND resourceId = 70')
    .run(JSON.stringify([{ date: legacy, start: '10:00', end: '11:00' }]), id);
  const kept = await f.save(id, { notes: 'Relue', resources: session(legacy) });
  assert.equal(kept.statusCode, 200, JSON.stringify(kept.body));
  const moved = await f.save(id, { resources: session(f.inDays(239)) });
  assert.deepEqual([moved.statusCode, moved.body], [400, bodyOf('sessions')]);
});

test('rule 13: PUT /devis/:id keeps an occurrence stored outside the stay, the same date on another line is refused', () => {
  const stay = { startDate: f.inDays(360), endDate: f.inDays(363) };
  const created = call(devisController.create, { body: f.stayBody({ ...stay, selectedOptions: occurrence(f.inDays(361)) }) });
  assert.equal(created.statusCode, 201, JSON.stringify(created.body));
  const legacy = f.inDays(200);
  f.db.prepare('UPDATE reservation_options SET cardOccurrences = ? WHERE reservationId = ? AND optionId = 50')
    .run(JSON.stringify([{ date: legacy, time: '08:00' }]), created.body.id);
  const update = (selectedOptions) => call(devisController.update, { params: { id: String(created.body.id) }, body: f.stayBody({ ...stay, selectedOptions }) });
  const kept = update(occurrence(legacy));
  assert.equal(kept.statusCode, 200, JSON.stringify(kept.body));
  assert.deepEqual(update([{ optionId: 51, quantity: 1, cardOccurrences: [{ date: legacy, time: '08:00' }] }]).body, bodyOf('cardOccurrences'));
});
