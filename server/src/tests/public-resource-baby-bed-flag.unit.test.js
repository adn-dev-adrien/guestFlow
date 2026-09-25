/**
 * specs/translation-catalogue.md rule 22 — what the funnel treats specially, it recognises by a flag
 * the server sets, never by a label the catalogue may have translated.
 *
 * The cot is the case that proved it. It is couchage, not a supplement: the widget filters it out of
 * the extras and drives it from the babies stepper instead. It filtered it out by matching « Lit
 * bébé » on the resource payload — and the day the catalogue started answering « Baby bed » to an
 * English page, the match failed and the cot was offered to every English visitor, babies or none.
 *
 * Rule 16 had already drawn this line for categories (« nothing downstream keys on a translated
 * string »); rule 22 finishes it for the labels the site acts on.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { isBabyBedResource } = require('../utils/babyBedResource');
const { toPublicResource } = require('../utils/publicProjections');

const COT = { id: 1, name: 'Lit bébé', priceType: 'per_stay', price: 0 };
const BATH = { id: 2, name: 'Bain nordique', priceType: 'per_hour', price: 30 };

/** A resolver that answers English, as the catalogue does in production. */
const ENGLISH = {
  lang: 'en',
  optionTitle: (id, french) => french,
  optionDescription: () => null,
  englishOptionTitle: () => null,
  resourceName: (id) => (id === 1 ? 'Baby bed' : 'Nordic bath'),
  englishResourceName: (id) => (id === 1 ? 'Baby bed' : 'Nordic bath'),
  category: (french) => french,
};

// ── The predicate ────────────────────────────────────────────────────────────

test('the cot is recognised whatever the accent and the case (rule 22)', () => {
  assert.equal(isBabyBedResource({ name: 'Lit bébé' }), true);
  assert.equal(isBabyBedResource({ name: 'Lit bebe' }), true);
  assert.equal(isBabyBedResource({ name: '  LIT BÉBÉ ' }), true);
  assert.equal(isBabyBedResource('lit bébé'), true);
});

test('nothing else is taken for a cot (rule 22)', () => {
  assert.equal(isBabyBedResource(BATH), false);
  assert.equal(isBabyBedResource({ name: 'Lit parapluie' }), false);
  assert.equal(isBabyBedResource({ name: '' }), false);
  assert.equal(isBabyBedResource(null), false);
});

// ── The payload ──────────────────────────────────────────────────────────────

test('the public resource carries the flag, in both languages (rule 22)', () => {
  assert.equal(toPublicResource(COT, 'fr').isBabyBed, true);
  assert.equal(toPublicResource(BATH, 'fr').isBabyBed, false);

  const english = toPublicResource(COT, 'en', ENGLISH);
  // The name IS translated — that is the whole point — and the flag does not move with it.
  assert.equal(english.name, 'Baby bed');
  assert.equal(english.isBabyBed, true);
  assert.equal(toPublicResource(BATH, 'en', ENGLISH).isBabyBed, false);
});

// ── The consumer ─────────────────────────────────────────────────────────────

const view = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'integrations', 'wordpress', 'guestflow-booking', 'blocks', 'booking', 'view.js'),
  'utf8',
);

// specs/wp-booking-widget-redesign.md rule 12 — the cot leaves the supplements list and becomes a
// stepper that exists only when there is a baby to put in it.
test('the widget keys the cot on the flag, not on the name alone (rule 12)', () => {
  const start = view.indexOf('var supplements =');
  assert.ok(start > 0, 'the supplements filter was renamed — this test has lost its subject');
  const filter = view.slice(start, view.indexOf('});', start));
  assert.ok(
    /isBabyBed/.test(filter),
    'the supplements filter still identifies the cot by its title: an English payload will not match',
  );
});

// specs/wp-booking-widget-redesign.md rule 12 again, its other half: the counter.
test('the cot stepper exists only when a baby does (rule 12)', () => {
  assert.ok(
    /if \(state\.babies > 0 && babyRes\)/.test(view),
    'the baby-beds stepper is no longer gated on the number of babies',
  );
  // And the count never survives the babies going back to zero.
  assert.ok(
    /state\.babyBeds = 0;/.test(view),
    'nothing resets the cot count when the babies are removed',
  );
});
