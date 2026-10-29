// specs/gites-de-france-mail-intake.md rule 29 (audit R2, finding N4) — the mail must open with the centrale's
// sentence; a relayed free text carrying a « nouvelle réservation » block is not an intake.
const test = require('node:test');
const assert = require('node:assert/strict');

const { parseGitesDeFranceMail } = require('../mailParser');
const { BOOKING_MAIL } = require('./fixtures');

test('rule 29: the genuine layout still parses', () => {
  assert.equal(parseGitesDeFranceMail(BOOKING_MAIL).ok, true);
});

test('rule 29: the same booking block without the opening sentence is refused', () => {
  const relayed = BOOKING_MAIL.replace(/^Une nouvelle réservation a été effectuée.*$/m, 'Message du client : nouvelle réservation');
  const out = parseGitesDeFranceMail(relayed);
  assert.equal(out.ok, false);
  assert.match(out.error, /pas une nouvelle réservation/);
});

test('rule 29: the sentence buried deep in the text does not count', () => {
  const buried = `Bonjour,\nbla\nbla\nbla\n${BOOKING_MAIL}`;
  assert.equal(parseGitesDeFranceMail(buried).ok, false);
});
