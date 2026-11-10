// specs/reservations-backend-mvc.md rule 26 (audit R42-C-L1, 2026-11-10) — painting a period into a NEW season on a
// logement that does not exist (a stale tab after its deletion) is refused 404 « Logement non trouvé », like every
// sibling pricing route: it used to reach the new season's foreign-key INSERT and answer 500. Nothing is written.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./reservationSaveFixture');
const propertiesController = require('../controllers/propertiesController');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

const inDays = (n) => addDaysToIsoDate(todayIso(), n);
const call = (handler, req) => { const res = f.respond(); handler({ user: f.ADMIN, params: {}, query: {}, ...req }, res); return res; };
const rules = (propertyId) => f.db.prepare('SELECT COUNT(*) AS n FROM pricing_rules WHERE propertyId = ?').get(propertyId).n;
const body = (target) => ({ startDate: inDays(40), endDate: inDays(43), minNights: 2, target });

test.before(() => f.seed());

test('rule 26 — assign-dates « new » on a logement that does not exist → 404, no season written', () => {
  const ghost = Number(f.db.prepare('SELECT COALESCE(MAX(id), 0) + 1000 AS n FROM properties').get().n);
  for (const id of [String(ghost), 'abc']) {
    const res = call(propertiesController.assignPricingDateRange, { params: { id }, body: body({ mode: 'new', label: 'Pont', pricePerNight: 90 }) });
    assert.equal(res.statusCode, 404, `${id}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.error, 'Logement non trouvé');
  }
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM pricing_rules WHERE propertyId NOT IN (SELECT id FROM properties)').get().n, 0);
});

test('rule 26 — assign-dates « new » on a real logement still creates its season', () => {
  const pid = Number(f.db.prepare('SELECT id FROM properties ORDER BY id LIMIT 1').get().id);
  const before = rules(pid);
  const res = call(propertiesController.assignPricingDateRange, { params: { id: String(pid) }, body: body({ mode: 'new', label: 'Pont', pricePerNight: 90 }) });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.ok(res.body.createdRuleId);
  assert.ok(rules(pid) > before);
});
