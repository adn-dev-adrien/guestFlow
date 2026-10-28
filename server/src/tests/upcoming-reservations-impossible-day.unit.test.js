const test = require('node:test');
const assert = require('node:assert/strict');

const { buildController } = require('../controllers/upcomingReservationsController');

// specs/upcoming-reservations-cards.md rule 10 — fixed at the 2026-10-27 spec review (F14): a `?day=`
// with the right shape but no calendar day behind it (`2026-13-01`, `2026-02-30`) answered 200 with no
// day instead of 400 « Date invalide. ».

function call(query) {
  const out = { status: 200, body: null };
  const controller = buildController({
    model: { arrivalIdsOn: () => [], arrivalIdsFrom: () => [] },
    detailOf: () => null,
    today: () => '2026-01-01',
  });
  controller.upcoming({ query }, {
    status(code) { out.status = code; return this; },
    json(b) { out.body = b; return this; },
  });
  return out;
}

test('impossible calendar days are refused 400 « Date invalide. »', () => {
  for (const day of ['2026-13-01', '2026-02-30', '2026-00-10', '2026-04-31']) {
    assert.deepEqual(call({ day }), { status: 400, body: { error: 'Date invalide.' } }, day);
  }
});

test('real days, including 29 February of a leap year, are accepted', () => {
  assert.equal(call({ day: '2028-02-29' }).status, 200);
  assert.equal(call({ day: '2026-12-31' }).status, 200);
});
