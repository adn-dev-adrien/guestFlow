// specs/settings-rationalization.md rule 33 (audit R2, finding N2) — every email check is bounded by its length
// first and linear after: the auditor's 195 KB payload returns in well under 50 ms, everywhere.
const test = require('node:test');
const assert = require('node:assert/strict');

const { isValidEmailAddress } = require('../utils/emailAddress');
const { isValidEmail } = require('../utils/clientValidation');
const { validateEmail } = require('../utils/settingsValidation');

const HOSTILE = `x@${'.'.repeat(200000)},`;
const timed = (fn) => { const t = process.hrtime.bigint(); const out = fn(); return { out, ms: Number(process.hrtime.bigint() - t) / 1e6 }; };

test('rule 33: the shared helper accepts ordinary addresses and refuses the malformed ones', () => {
  for (const ok of ['a@b.co', ' claire@aulnes.fr ', 'x+tag@sub.domain.example', 'a@b..c']) assert.equal(isValidEmailAddress(ok), true, ok);
  for (const bad of ['', 'a@b', 'a@@b.c', '@b.c', 'a b@c.d', 'a@b.c,d@e.f', 'a@b.c;', '<a@b.c>', 'a@.', 'a@b.', 'a@.b', `${'a'.repeat(250)}@b.co`]) {
    assert.equal(isValidEmailAddress(bad), false, bad);
  }
});

test('rule 33: client, settings and server helpers return in < 50 ms on the same payload', () => {
  for (const fn of [isValidEmailAddress, isValidEmail, (v) => validateEmail(v) === null]) {
    const { out, ms } = timed(() => fn(HOSTILE));
    assert.ok(ms < 50, `${ms} ms`);
    assert.equal(out, false);
  }
});
