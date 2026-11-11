const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// specs/finance-dashboard-redesign.md rule 37 — « today » is the operator's calendar day (the
// process's time zone), never the UTC one: at 01:56 CEST on 18 Oct the finance page said « au 17 oct. »
// (mega review #5, m1).
const { localIsoDate, todayIso } = require('../utils/localDate');
const { getTodayIsoDate } = require('../utils/reservationHelpers');
const financeModel = require('../models/financeModel');

test('rule 37 — a local instant just after midnight is that day, not the UTC one', () => {
  // 18 Oct 2026, 00:30 local time — whatever the zone, the local date is the 18th.
  const justAfterMidnight = new Date(2026, 9, 18, 0, 30, 0);
  assert.equal(localIsoDate(justAfterMidnight), '2026-10-18');
  if (process.env.TZ === 'Europe/Paris') {
    assert.equal(justAfterMidnight.toISOString().slice(0, 10), '2026-10-17', 'UTC is still yesterday in Paris');
  }
});

test('rule 37 — every server helper of « today » reads the same local day', () => {
  const day = localIsoDate(new Date());
  assert.equal(todayIso(), day);
  assert.equal(getTodayIsoDate(), day);
  assert.equal(financeModel.helpers.todayIso(), day);
});

test('rule 37 — no server module derives « today » from toISOString', () => {
  const root = path.join(__dirname, '..');
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'tests' || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) {
        const src = fs.readFileSync(full, 'utf8');
        if (/new Date\(\)\.toISOString\(\)\.(split\('T'\)\[0\]|slice\(0, ?10\))/.test(src)) offenders.push(path.relative(root, full));
      }
    }
  };
  walk(root);
  assert.deepEqual(offenders, []);
});
