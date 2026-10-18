// specs/guest-email-texts-made-simple.md rule 27 (2026-10-18) — a known variable in one pair of
// braces, « {clientFirstName} », is refused: the renderer would send it as it is.

const test = require('node:test');
const assert = require('node:assert/strict');

const { tokenError } = require('../utils/templateTokens');

const allowed = { tokens: ['clientFirstName', 'propertyName'], flags: ['hasX'] };

test('rule 27: « {clientFirstName} » is refused like a broken variable', () => {
  const error = tokenError('fr', 'Le ménage {clientFirstName} ok', allowed);
  assert.deepEqual(error, { field: 'fr', message: 'Variable incomplète : la remettre depuis les boutons.' });
  assert.ok(tokenError('fr', 'À bientôt { propertyName }', allowed));
  assert.ok(tokenError('fr', 'Voir {hasX}', allowed));
});

test('rule 27: a variable known elsewhere in single braces is refused too', () => {
  assert.ok(tokenError('fr', 'Le {cautionAmount}', allowed));
});

test('rule 27: prose in braces and well-formed variables still pass', () => {
  assert.equal(tokenError('fr', 'Bonjour {{clientFirstName}}, {à bientôt}', allowed), null);
  assert.equal(tokenError('fr', '{{#if hasX}}Le {{propertyName}}{{/if}} {note}', allowed), null);
});
