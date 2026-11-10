// specs/guest-app.md rule 79 (audit of the J-7 branch, item 6 / N13) — the home card's « Premier créneau libre » counts the bath's
// heat-up from NOW, like the slot picker: on the arrival day, once the stay window is open (check-in − 3 h) and before the 4 pm check-in,
// a 3 h heat-up started now ends before 6.30 pm; counted from the check-in it would end at 7 pm.
const fx = require('./guestOrderFixtures');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addBath, db, isoPlus, openOrdering, seedStay, sell,
} = fx;
const { skipWithout } = require('../../sdk/testing');

const BATH = addBath({ id: 73, freeMinutes: {} });
sell('resource', BATH);
db.prepare(`UPDATE resources SET heatUpMinutes = 180, heatRetentionMinutes = 120, turnoverMinutes = 0, showsPlanningCard = 1 WHERE id = ?`).run(BATH);

test('rule 79 (N13): the arrival day first free slot counts the heat-up from now, not from the check-in', { skip: skipWithout(['hourly-resources']) }, async () => {
  db.prepare('DELETE FROM resource_bookings').run();
  const stayId = seedStay({ start: 0, end: 4, checkedIn: 0 });
  const ctx = await openOrdering(stayId, { guestHost: 'sejour.example.test' });
  try {
    // 12:30 UTC is 13:30 or 14:30 in Paris whatever the season: inside the window, before the check-in.
    ctx.clock.now = new Date(`${isoPlus(0)}T12:30:00Z`);
    const highlight = (await ctx.call('GET', '/public/v1/guest/me')).body.data.highlight;
    assert.equal(highlight && highlight.key, 'bath', JSON.stringify(highlight));
    const hour = Number(/(\d{1,2})\s*h/.exec(highlight.detail)[1]);
    assert.ok(hour <= 18, `the first free slot is ${highlight.detail}`);
  } finally {
    await ctx.close();
  }
});
