// specs/guest-email-texts-made-simple.md rule 11, reading of 2026-11-05 (audit R24-I4) — a name only an object's
// prototype holds (constructor, toString, __proto__…) is a name nobody knows: « Variable inconnue : {{name}} », never
// the text of a native function; a chip of such a name is labelled by the name itself.
const test = require('node:test');
const assert = require('node:assert/strict');
const { tokenError, templateAllowed, chipsForText, STAY_TOKEN_LABELS } = require('../utils/templateTokens');

const PROTOTYPE_NAMES = ['constructor', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', '__proto__', 'propertyIsEnumerable', 'toLocaleString'];

test('rule 11 — a prototype name in a text is an unknown variable', () => {
  const allowed = templateAllowed();
  for (const name of PROTOTYPE_NAMES) {
    const refusal = tokenError('body', `Bonjour {{${name}}}`, allowed);
    assert.ok(refusal, name);
    assert.equal(refusal.message, `Variable inconnue : {{${name}}}`, name);
    assert.doesNotMatch(refusal.message, /native code|\[object/, name);
  }
});

test('rule 11 — a known stay token keeps its label, a prototype name its own name', () => {
  assert.equal(tokenError('body', '{{price}}', templateAllowed()).message, `Variable non disponible ici : ${STAY_TOKEN_LABELS.price}`);
  const chips = chipsForText({ tokens: ['price', ...PROTOTYPE_NAMES] });
  assert.equal(chips.variables[0].label, STAY_TOKEN_LABELS.price);
  for (const [i, name] of PROTOTYPE_NAMES.entries()) assert.equal(chips.variables[i + 1].label, name);
  const flags = chipsForText({ flags: PROTOTYPE_NAMES });
  for (const [i, name] of PROTOTYPE_NAMES.entries()) assert.equal(flags.conditions[i].label, name);
});
