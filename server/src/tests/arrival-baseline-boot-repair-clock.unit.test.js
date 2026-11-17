// specs/arrival-moment-is-the-check-in.md §3 rule 3, amended 2026-11-16 (stabilisation loop t4, D4-2, D4-3).
// specs/pricing-components.md rules 102 a, 103 b — the boot repair clears the arrival-extras baseline only of a stay the stay clock has not started, and never one that carved a line
// out to the departure. Before, every restart between the check-in hour and the tick erased the baseline pricing-components rule 102 had laid: the departure part
// of a grown line left every bucket (306 + 0 + 45 = 351 € for a final price of 363 €).
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, beer, addDaysToIsoDate } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');
const { storedBody } = require('../utils/stayOrderLines');
const controller = require('../controllers/reservationsController');
const { clearPreArrivalBaselines } = require('../utils/complementDataRepairs');

const at = (id, time, offset = 0) => new Date(`${addDaysToIsoDate(row(id).startDate, offset)}T${time}:00`);
const cents = (value) => Math.round(Number(value || 0) * 100);
const BASELINE = JSON.stringify({ x: 1 });
const withBaseline = (id) => db.prepare('UPDATE reservations SET arrivalExtrasBaseline = ? WHERE id = ?').run(BASELINE, id);
const beerLine = (id) => db.prepare('SELECT lineId FROM reservation_options WHERE reservationId = ? ORDER BY lineId LIMIT 1').get(id).lineId;

function futureStayWithBeer() {
  const id = stay(20);
  assert.equal(extraSale.sell(id, [{ articleRef: `option:${beer}`, quantity: 1 }], { now: at(id, '12:00', -10) }).status, 200);
  withBaseline(id);
  return id;
}

test('D4-3 — a stay not started, nothing carved out: its baseline is cleared', () => {
  const id = futureStayWithBeer();
  assert.ok(clearPreArrivalBaselines(db, { now: at(id, '12:00', -5) }).includes(id));
  assert.equal(row(id).arrivalExtrasBaseline, null);
});

test('D4-3 — a stay not started that carved a line out to the departure keeps its baseline (pricing-components rule 103 b)', () => {
  const id = futureStayWithBeer();
  db.prepare("UPDATE reservation_options SET collectAt = 'departure' WHERE lineId = ?").run(beerLine(id));
  assert.ok(!clearPreArrivalBaselines(db, { now: at(id, '12:00', -5) }).includes(id));
  assert.equal(row(id).arrivalExtrasBaseline, BASELINE);
});

test('D4-3 — a stay holding only a departure charge stamped at the departure keeps its baseline', () => {
  const id = futureStayWithBeer();
  db.prepare(`INSERT INTO reservation_custom_options (reservationId, description, amount, sasLineKey, source, collectAt)
    VALUES (?, 'Ménage', 50, 'departure:cleaning', 'sas', 'departure')`).run(id);
  assert.ok(!clearPreArrivalBaselines(db, { now: at(id, '12:00', -5) }).includes(id));
  assert.equal(row(id).arrivalExtrasBaseline, BASELINE);
});

test('D4-2 — on the arrival day, before the check-in hour the baseline is cleared; past it the clock started and it stays', () => {
  const kept = futureStayWithBeer();
  assert.ok(!clearPreArrivalBaselines(db, { now: at(kept, '18:30') }).includes(kept));
  assert.equal(row(kept).arrivalExtrasBaseline, BASELINE);
  const cleared = futureStayWithBeer();
  assert.ok(clearPreArrivalBaselines(db, { now: at(cleared, '10:00') }).includes(cleared));
  assert.equal(row(cleared).arrivalExtrasBaseline, null);
});

for (const reboot of [false, true]) {
  test(`D4-2 — a clock-started stay whose plan line grew keeps every euro in a bucket${reboot ? ' across a restart' : ''}`, () => {
    const id = stay(20);
    assert.equal(extraSale.sell(id, [{ articleRef: `option:${beer}`, quantity: 1 }], { now: at(id, '12:00', -10) }).status, 200);
    db.prepare("UPDATE reservation_options SET collectAt = 'plan', inComplement = 0 WHERE reservationId = ?").run(id);
    assert.equal(controller.performUpdate(id, { ...storedBody(id), restatePricing: true }, { now: at(id, '12:00', -9) }).status, 200);
    const grown = storedBody(id);
    grown.options = grown.options.map((option) => ({ ...option, quantity: 3 }));
    assert.equal(controller.performUpdate(id, grown, { now: at(id, '18:30') }).status, 200);
    assert.ok(row(id).arrivalExtrasBaseline, 'pricing-components rule 102 laid a baseline on the started stay');
    if (reboot) assert.ok(!clearPreArrivalBaselines(db, { now: at(id, '18:45') }).includes(id));
    assert.equal(extraSale.sell(id, [{ articleRef: 'custom', label: 'Panier', amount: 45 }], { now: at(id, '19:00') }).status, 200);
    const r = row(id);
    assert.equal(cents(r.depositAmount) + cents(r.balanceAmount) + cents(r.complementAmount) + cents(r.endOfStayComplementAmount), cents(r.finalPrice));
    assert.equal(cents(r.endOfStayComplementAmount), 5700);
  });
}

// Loop t5 D5-2 (2026-11-16) — a false start kept because the arrival complement is overridden (S4-2) survives a restart: the repair keeps the
// same three reasons as `unmarkArrival`. Before, a restart before the hour cleared it, then a sale was refused 409 COMPLEMENT_OVERRIDDEN that
// passed without the restart, and the next restate moved the departure's money into the balance.
test('D5-2 — a kept false start with an overridden complement keeps its baseline across a restart', () => {
  const { withNow } = require('../utils/localDate');
  const tick = (id, checkInDone, now) => withNow(now, () => {
    let status = 200;
    controller.updatePayment({ params: { id: String(id) }, body: { checkInDone }, query: {}, user: { id: 1, role: 'admin' } },
      { status(s) { status = s; return this; }, json() { return this; } });
    return status;
  });
  const id = stay(20);
  assert.equal(extraSale.sell(id, [{ articleRef: `option:${beer}`, quantity: 1 }], { now: at(id, '12:00', -10) }).status, 200);
  db.prepare("UPDATE reservation_options SET collectAt = 'plan', inComplement = 0 WHERE reservationId = ?").run(id);
  assert.equal(controller.performUpdate(id, { ...storedBody(id), restatePricing: true }, { now: at(id, '12:00', -9) }).status, 200);
  db.prepare('UPDATE reservations SET complementAmountOverride = 20 WHERE id = ?').run(id);
  assert.equal(tick(id, true, at(id, '09:00')), 200);
  const grown = storedBody(id);
  grown.options = grown.options.map((option) => ({ ...option, quantity: 3 }));
  assert.equal(controller.performUpdate(id, grown, { now: at(id, '09:10') }).status, 200);
  assert.equal(tick(id, false, at(id, '09:30')), 200);
  const kept = row(id).arrivalExtrasBaseline;
  assert.ok(kept, 'S4-2 keeps the false start of an overridden complement');
  const before = [cents(row(id).balanceAmount), cents(row(id).endOfStayComplementAmount)];
  assert.ok(!clearPreArrivalBaselines(db, { now: at(id, '09:45') }).includes(id));
  assert.equal(row(id).arrivalExtrasBaseline, kept);
  assert.equal(extraSale.sell(id, [{ articleRef: 'custom', label: 'Panier', amount: 45 }], { now: at(id, '10:00') }).status, 200);
  assert.equal(controller.performUpdate(id, { ...storedBody(id), restatePricing: true }, { now: at(id, '10:06') }).status, 200);
  assert.equal(cents(row(id).balanceAmount), before[0]);
  assert.ok(cents(row(id).endOfStayComplementAmount) >= before[1]);
});

// Loop t5 D5-3 (2026-11-16) — a candidate whose stored date is not a calendar day keeps its baseline and the repair goes on with the others;
// before, `STAY_CLOCK_INVALID` escaped the boot and the server did not start.
test('D5-3 — an unreadable stored date never fails the repair: that stay keeps its baseline, the others are still cleared', () => {
  const broken = futureStayWithBeer();
  const cleared = futureStayWithBeer();
  db.prepare("UPDATE reservations SET endDate = '2027-02-30' WHERE id = ?").run(broken);
  const now = at(cleared, '12:00', -5);
  const warn = console.warn;
  const warned = [];
  console.warn = (message) => warned.push(String(message));
  let result;
  try { result = clearPreArrivalBaselines(db, { now }); } finally { console.warn = warn; }
  assert.ok(!result.includes(broken));
  assert.ok(result.includes(cleared));
  assert.equal(row(broken).arrivalExtrasBaseline, BASELINE);
  assert.ok(warned.some((message) => message.includes(`reservation ${broken}`)));
});
