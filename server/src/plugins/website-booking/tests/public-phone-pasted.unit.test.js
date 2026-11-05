require('./isolatedDb');
// specs/public-api.md rule 25 (audit R24 public finding 2) — a phone pasted with a no-break space, a narrow no-break
// space, bidi marks around it or a zero-width space reads as the number it shows: every \p{Cf} leaves it, a \p{Zs}
// is a space, and the cleaned number is what is stored. A line break, a letter or a slash is still refused.
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateGuest } = require('../publicInputValidation');

const guest = (phone) => ({ firstName: 'Ana', lastName: 'Bel', email: 'ana@example.test', phone });

for (const [what, phone, stored] of [
  ['a no-break space between groups', '06 12 34 56 78', '06 12 34 56 78'],
  ['a narrow no-break space', '06 12 34 56 78', '06 12 34 56 78'],
  ['bidi embedding marks from a contact card', '‪+33 6 12 34 56 78‬', '+33 6 12 34 56 78'],
  ['a trailing zero-width space', '0612345678​', '0612345678'],
  ['an ideographic space', '06　12　34　56　78', '06 12 34 56 78'],
]) {
  test(`rule 25 — ${what}: accepted, stored as it reads`, () => {
    const g = validateGuest(guest(phone));
    assert.equal(g.ok, true, JSON.stringify(g.errors));
    assert.equal(g.value.phone, stored);
  });
}

for (const [what, phone] of [
  ['a line break', '06 12 34\n56 78'],
  ['a slash', '06/12/34/56/78'],
  ['a letter', '06 12 34 56 7O'],
]) {
  test(`rule 25 — ${what} is still phoneInvalid`, () => {
    const g = validateGuest(guest(phone));
    assert.equal(g.ok, false);
    assert.equal(g.errors[0].reason, 'phoneInvalid');
  });
}

test('rule 25 — a phone of format characters alone is required, not invalid', () => {
  const g = validateGuest(guest('​‪‬'));
  assert.equal(g.errors[0].reason, 'required');
});
