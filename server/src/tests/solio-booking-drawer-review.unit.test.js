// specs/site-booking-drawer.md rules 14-16 (review of 2026-10-18). Rule 14: the drawer wraps the
// booking engine only on the pages that load its stylesheet and script — elsewhere (a « Réserver » or
// « Payer » page) it left a bare button over an engine no click could reach. Rule 15: the insurance
// notice link speaks the page's language and the yes/no switch is named after its option. Rule 16: on
// a phone the e-mail and « Effacer » take a row each.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const MU = path.join(__dirname, '..', '..', '..', 'integrations', 'wordpress', 'solio-site', 'mu-plugins');
const drawer = fs.readFileSync(path.join(MU, 'gf-seo-reservation.php'), 'utf8');
const i18n = fs.readFileSync(path.join(MU, 'gf-i18n.php'), 'utf8');

test('rule 14: the render_block filter returns the engine untouched outside the lodging pages', () => {
  const filter = drawer.slice(drawer.indexOf("'render_block'"), drawer.indexOf('ob_start()'));
  assert.match(filter, /if \( ! gf_resa_page_concernee\(\) \) \{\s*return \$contenu;/);
});

test('rule 15: the notice label comes from the dictionary, in both languages', () => {
  assert.doesNotMatch(drawer, /innerHTML = '<a href="\/wp-content\/uploads\/2026\/09\/notice/);
  assert.match(drawer, /'notice'\s+=> \$lbl2\( 'resa_notice_assurance'/);
  assert.match(drawer, /a\.textContent = T\.notice/);
  assert.equal((i18n.match(/'resa_notice_assurance' =>/g) || []).length, 2, 'one French and one English entry');
});

test('rule 15: the yes/no switch carries the option title as its name', () => {
  assert.match(drawer, /box\.setAttribute\( 'aria-label', \( titre\.firstElementChild \|\| titre \)\.textContent\.trim\(\) \)/);
});

test('rule 16: the e-mail has its own row in the drawer, « Effacer » too on a phone', () => {
  assert.match(drawer, /\.gf-resa-etape \.gf-row > \.gf-field-email \{ flex-basis: 100%; \}/);
  assert.match(drawer, /@media \(max-width: 600px\) \{\s*\.gf-resa-etape \.gf-row > \.gf-field-clear \{ flex-basis: 100%; \}/);
});
