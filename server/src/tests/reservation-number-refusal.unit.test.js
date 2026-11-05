// specs/reservations-backend-mvc.md rule 24 (audit R23-6) — a reservation number too long or holding control characters
// is refused in words that name the field, as `INVALID_FIELD` with its `field`; a stored one sent back unchanged passes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { stayShapeRefusal } = require('../utils/stayInputShape');

const TOO_LONG = { error: 'Numéro de réservation : 64 caractères au plus.', code: 'INVALID_FIELD', field: 'reservationNumber' };
const CONTROL = { error: 'Numéro de réservation : caractères non acceptés.', code: 'INVALID_FIELD', field: 'reservationNumber' };

test('rule 24 — 65 characters are refused by name, 64 pass', () => {
  assert.deepEqual(stayShapeRefusal({ reservationNumber: 'x'.repeat(65) }), TOO_LONG);
  assert.equal(stayShapeRefusal({ reservationNumber: 'x'.repeat(64) }), null);
});

test('rule 24 — a control character is refused, line break, tab, NUL, DEL, C1', () => {
  for (const value of ['A\r\nX-INJ:1', 'A\nB', 'A\tB', 'A\u0000B', 'A\u007fB', 'A\u0085B']) {
    assert.deepEqual(stayShapeRefusal({ reservationNumber: value }), CONTROL, JSON.stringify(value));
  }
});

test('rule 24 — the numbers platforms really write pass: letters, digits, dashes, spaces, accents', () => {
  for (const value of ['6669322709', 'HMABC-123', 'GF 309700/12', 'résa-1', '']) {
    assert.equal(stayShapeRefusal({ reservationNumber: value }), null, value);
  }
});

test('rule 24 — a stored value sent back unchanged is not judged', () => {
  for (const value of ['x'.repeat(80), 'A\r\nB']) {
    assert.equal(stayShapeRefusal({ reservationNumber: value }, { reservationNumber: value }), null);
    assert.ok(stayShapeRefusal({ reservationNumber: `${value}z` }, { reservationNumber: value }));
  }
});

test('rule 24 — not a string stays the generic refusal of rule 20', () => {
  assert.deepEqual(stayShapeRefusal({ reservationNumber: 5000 }), { error: 'Valeur invalide.', code: 'INVALID_FIELD', field: 'reservationNumber' });
});
