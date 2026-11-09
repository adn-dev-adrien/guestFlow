const test = require('node:test');
const assert = require('node:assert/strict');

// specs/stay-profile.md §3 rule 25 (reviews R4-4 / R6-1) — a month that names none (« 13 », « 00 »)
// is refused by the shared finance window with « Ce mois n'appartient pas à l'exercice choisi. », even
// when it sorts inside an exercise closing in September; every endpoint reading a month window answers
// that 400, never a 200 on garbage nor a 500.
const db = require('../database');
const { resolveWindow, MESSAGES } = require('../utils/financeWindow');
const fiscalYearUtil = require('../utils/fiscalYear');
const { todayIso } = require('../utils/localDate');
const finance = require('../controllers/financeController');
const stayProfile = require('../controllers/stayProfileController');

const TODAY = todayIso();
const exercise = fiscalYearUtil.containing(9, TODAY);
const startYear = exercise.from.slice(0, 4);
// Months that sort between the exercise's bounds as text but name no month.
const IMPOSSIBLE = [`${startYear}-13`, `${startYear}-99`, `${Number(startYear) + 1}-00`, `${startYear}-1`, `${startYear}-012`];

function call(handler, req) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ status: this.statusCode, body }); return this; },
    };
    handler({ query: {}, params: {}, ...req }, res);
  });
}

test('rule 25 — resolveWindow refuses a month that names none, accepts 01 to 12', () => {
  for (const month of IMPOSSIBLE) {
    assert.deepEqual(resolveWindow({ exercise, kind: 'month', month, today: TODAY }), { ok: false, error: MESSAGES.badMonth }, month);
  }
  const first = exercise.from.slice(0, 7);
  assert.equal(resolveWindow({ exercise, kind: 'month', month: first, today: TODAY }).ok, true);
  assert.equal(resolveWindow({ exercise, kind: 'month', month: exercise.to.slice(0, 7), today: TODAY }).ok, true);
});

test('rule 25 — the dashboard, its detail tables and the stay profile answer 400 badMonth', async () => {
  db.prepare('INSERT INTO app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING').run();
  const before = db.prepare('SELECT fiscalYearEndMonth AS m FROM app_settings WHERE id = 1').get().m;
  db.prepare('UPDATE app_settings SET fiscalYearEndMonth = 9 WHERE id = 1').run();
  try {
    for (const month of IMPOSSIBLE) {
      const query = { period: 'month', month };
      const answers = [
        await call(finance.getDashboard, { query }),
        await call(finance.getDashboardDetail, { query, params: { tile: 'stays' } }),
        await call(finance.getDashboardDetail, { query, params: { tile: 'channels' } }),
        await call(stayProfile.getStayProfile, { query }),
      ];
      for (const a of answers) assert.deepEqual(a, { status: 400, body: { error: MESSAGES.badMonth } }, month);
    }
    const ok = await call(stayProfile.getStayProfile, { query: { period: 'month', month: exercise.from.slice(0, 7) } });
    assert.equal(ok.status, 200);
  } finally {
    db.prepare('UPDATE app_settings SET fiscalYearEndMonth = ? WHERE id = 1').run(before);
  }
});
