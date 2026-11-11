// specs/settings-rationalization.md rule 33 (audit R2, finding N2) — the public guest email is bounded by its length first.
const test = require('node:test');
const assert = require('node:assert/strict');

const { validateGuest } = require('../publicInputValidation');

const timed = (fn) => { const t = process.hrtime.bigint(); const out = fn(); return { out, ms: Number(process.hrtime.bigint() - t) / 1e6 }; };
const HOSTILE = `x@${'.'.repeat(200000)},`;

test('rule 33: the public booking guest validation returns in < 50 ms on the 195 KB payload', () => {
  const { out, ms } = timed(() => validateGuest({ firstName: 'A', lastName: 'B', email: HOSTILE, phone: '0612345678' }));
  assert.ok(ms < 50, `${ms} ms`);
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.field === 'guest.email'));
});

// specs/wordpress-plugin.md rule 32 (audit R2, external N2) — format characters are stripped from a guest name.
test('rule 32: bidi overrides and zero-width characters are stripped from a public guest name, accents stay', () => {
  const out = validateGuest({ firstName: 'Cl\u200Baire', lastName: 'Gar\u202Enier Éloïse', email: 'a@b.fr', phone: '0612345678' });
  assert.equal(out.ok, true);
  assert.equal(out.value.firstName, 'Claire');
  assert.equal(out.value.lastName, 'Garnier Éloïse');
});
