// specs/finance-dashboard-redesign.md rule 40 — the email runners and the email draft preview read
// « today » from utils/localDate, the operator's calendar day, like every other server module
// (rule 37). Final code review, lows 3 and 4.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { __test: { isoDay } } = require('../utils/emailDraftPreview');

const src = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('rule 40 — the draft preview\'s « today » just after midnight is that day, not the UTC one', () => {
  const justAfterMidnight = new Date(2026, 9, 18, 0, 30, 0);
  assert.equal(isoDay(0, justAfterMidnight), '2026-10-18');
  assert.equal(isoDay(-1, justAfterMidnight), '2026-10-17');
});

test('rule 40 — the draft preview\'s sample stay counts calendar days, across a DST change too', () => {
  // 25 Oct 2026 is the autumn change in Europe/Paris: a 24 h step would land on the wrong day at 00:30.
  const beforeChange = new Date(2026, 9, 24, 0, 30, 0);
  assert.equal(isoDay(9, beforeChange), '2026-11-02');
  assert.equal(isoDay(12, beforeChange), '2026-11-05');
});

test('rule 40 — the email runners keep no « today » of their own', () => {
  for (const rel of ['utils/emailAutoSendRunner.js', 'utils/guestEmailSequenceRunner.js', 'utils/emailDraftPreview.js']) {
    const code = src(rel);
    assert.doesNotMatch(code, /function isoToday|toISOString\(\)\.slice\(0, ?10\)/, rel);
    assert.match(code, /require\('\.\/localDate'\)/, rel);
  }
  assert.equal(require('../utils/emailAutoSendRunner').isoToday, undefined);
  assert.equal(require('../utils/guestEmailSequenceRunner').isoToday, undefined);
});
