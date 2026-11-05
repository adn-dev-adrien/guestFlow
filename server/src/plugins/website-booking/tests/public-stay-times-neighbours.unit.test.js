require('./isolatedDb');
// specs/public-api.md rule 24 (audit R24 public finding 1) — the visitor's own arrival and departure times are judged
// against the neighbouring stays as the back office judges them (`validateAvailability`: the cleaning gap, the night
// before an early arrival, the night after a late departure). `/quote` and `/booking-requests` refuse with
// 409 STAY_TIMES_UNAVAILABLE and one visitor sentence; nothing is stored. An early time with no neighbour is sold.
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../../database');
const { localIsoDate } = require('../../../utils/localDate');
require('../settings').termsSettings = () => ({ requireTermsAcceptance: false });
const bookingCtl = require('../controllers/publicBookingRequestController');
const quoteCtl = require('../controllers/publicQuoteController');

const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return localIsoDate(d); };

const pid = Number(db.prepare(`INSERT INTO properties (name, maxGuests, cleaningHours, defaultCheckIn, defaultCheckOut)
  VALUES ('Gîte', 6, 3, '16:00', '10:00')`).run().lastInsertRowid);
db.prepare(`INSERT INTO pricing_rules (propertyId, label, pricePerNight, dateRanges, minNights) VALUES (?, 'Saison', 120, ?, 1)`)
  .run(pid, JSON.stringify([{ startDate: inDays(1), endDate: inDays(400) }]));
const otherClient = Number(db.prepare("INSERT INTO clients (firstName, lastName, email) VALUES ('Voisin', 'Test', 'voisin@example.test')").run().lastInsertRowid);

function addStay(startDate, endDate, checkInTime, checkOutTime) {
  db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults, finalPrice, platform, checkInTime, checkOutTime)
    VALUES ('reservation', ?, ?, ?, ?, 2, 400, 'direct', ?, ?)`).run(pid, otherClient, startDate, endDate, checkInTime, checkOutTime);
}

// A stay leaving at 10:00 (house ready at 13:00), a stay arriving at 16:00 (house free until 13:00), a stay leaving at 12:30.
const LEAVES = inDays(60);
const ARRIVES = inDays(90);
const LEAVES_LATE = inDays(150);
addStay(inDays(53), LEAVES, '16:00', '10:00');
addStay(ARRIVES, inDays(95), '16:00', '10:00');
addStay(inDays(143), LEAVES_LATE, '16:00', '12:30');

const res = () => ({ statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
let seq = 0;
const stay = (startDate, endDate, times = {}) => ({ propertyId: pid, startDate, endDate, adults: 2, ...times });
const reqOf = (body, lang) => ({ body: { ...body, ...(lang ? { lang } : {}) }, headers: {}, query: lang ? { lang } : {} });

function request(body, lang) {
  seq += 1;
  const r = res();
  bookingCtl.create(reqOf({ ...body, guest: { firstName: 'Ana', lastName: 'Bel', email: `ana${seq}@example.test`, phone: '+33612345678' } }, lang), r);
  return r;
}
async function quote(body, lang) {
  const r = res();
  await quoteCtl.quote(reqOf(body, lang), r);
  return r;
}
const devisCount = () => db.prepare("SELECT COUNT(*) AS n FROM reservations WHERE kind = 'devis'").get().n;

const REFUSED = [
  ['an arrival inside the cleaning gap (12:00 after a 10:00 departure)', stay(LEAVES, inDays(67), { checkInTime: '12:00', checkOutTime: '10:00' })],
  ['an arrival at 10:00, which takes the night before', stay(LEAVES, inDays(67), { checkInTime: '10:00', checkOutTime: '10:00' })],
  ['a departure inside the cleaning gap (14:00 before a 16:00 arrival)', stay(inDays(83), ARRIVES, { checkInTime: '16:00', checkOutTime: '14:00' })],
  ['a departure at 18:00, which takes the night after', stay(inDays(83), ARRIVES, { checkInTime: '16:00', checkOutTime: '18:00' })],
];

for (const [what, body] of REFUSED) {
  test(`rule 24 — ${what}: the request is refused, nothing stored`, () => {
    const before = devisCount();
    const r = request(body);
    assert.equal(r.statusCode, 409, JSON.stringify(r.body));
    assert.equal(r.body.error.code, 'STAY_TIMES_UNAVAILABLE');
    assert.equal(r.body.error.message, 'Horaires indisponibles à ces dates : modifier l’heure d’arrivée ou de départ.');
    assert.equal(devisCount(), before);
  });

  test(`rule 24 — ${what}: the quote says it first, with the same code`, async () => {
    const q = await quote(body);
    assert.equal(q.statusCode, 409, JSON.stringify(q.body));
    assert.equal(q.body.error.code, 'STAY_TIMES_UNAVAILABLE');
  });
}

test('rule 24 — the refusal follows the site language', async () => {
  const [, body] = REFUSED[0];
  const expected = 'These times are not available on these dates: change the check-in or check-out time.';
  assert.equal(request(body, 'en').body.error.message, expected);
  assert.equal((await quote(body, 'en')).body.error.message, expected);
});

test('rule 24 — the default arrival after a departure, the house ready in time: sold', async () => {
  const body = stay(LEAVES, inDays(67), { checkInTime: '16:00', checkOutTime: '10:00' });
  assert.equal((await quote(body)).body.data.available, true);
  assert.equal(request(body).statusCode, 201);
});

test('rule 24 — an early arrival with no neighbour stays allowed', async () => {
  const body = stay(inDays(200), inDays(204), { checkInTime: '08:00', checkOutTime: '19:00' });
  assert.equal((await quote(body)).statusCode, 200);
  assert.equal(request(body).statusCode, 201);
});

test('rule 24 — no time sent: the property’s 16:00 is judged, not the 15:00 fallback', async () => {
  // The neighbour leaves at 12:30: with 3 h of cleaning the house is ready at 15:30.
  const body = stay(LEAVES_LATE, inDays(155));
  assert.equal((await quote(body)).statusCode, 200);
  const r = request(body);
  assert.equal(r.statusCode, 201, JSON.stringify(r.body));
  assert.equal(request(stay(LEAVES_LATE, inDays(156), { checkInTime: '15:00' })).body.error.code, 'STAY_TIMES_UNAVAILABLE');
});

test('rule 24 — nights already taken still answer DATES_UNAVAILABLE, not the times refusal', async () => {
  const body = stay(inDays(55), inDays(58), { checkInTime: '16:00', checkOutTime: '10:00' });
  assert.equal(request(body).body.error.code, 'DATES_UNAVAILABLE');
  assert.equal((await quote(body)).body.data.available, false);
});
