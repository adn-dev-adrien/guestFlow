/**
 * specs/gift-voucher-campaigns.md rule 63 — the offer switcher heading an open campaign replaces the
 * « Choisir une autre offre » link. Static checks on the plugin sources: the block cannot run here.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PLUGIN = path.join(__dirname, '..', '..', '..', 'integrations', 'wordpress', 'guestflow-booking');
const read = (...p) => fs.readFileSync(path.join(PLUGIN, ...p), 'utf8');
const view = read('blocks', 'gift-voucher', 'view.js');
const php = read('includes', 'class-gf-blocks.php');
const css = read('assets', 'style.css');
const po = read('languages', 'guestflow-booking-en_GB.po');
const mo = fs.readFileSync(path.join(PLUGIN, 'languages', 'guestflow-booking-en_GB.mo'));

test('rule 63 — the switcher is built only when more than one campaign is on sale', () => {
  assert.match(view, /campaigns\.length > 1 \? switcher\(campaign\) : null/);
});

test('rule 63 — every other card opens its campaign through the one open() entry point', () => {
  const body = /function switcher\(current\) \{[\s\S]*?\n    \}\n/.exec(view)[0];
  assert.match(body, /open\(c\.slug, true\)/);
  assert.match(body, /if \(c\.slug === current\.slug\) opt\.setAttribute\('aria-current', 'true'\)/);
  assert.match(body, /'aria-label': GF\.t\('gvYourGift'\)/);
});

test('rule 63 — the open card is scrolled into view on the row, never with scrollIntoView', () => {
  assert.match(view, /\.scrollLeft = here\.offsetLeft/);
  assert.doesNotMatch(view, /scrollIntoView/);
});

test('rule 63 — the back link and its string are gone from the view, the PHP strings and the stylesheet', () => {
  for (const src of [view, php, css]) {
    assert.doesNotMatch(src, /gvOtherOffer|gf-gv-back/);
  }
  assert.doesNotMatch(po, /Choisir une autre offre/);
});

test('rule 63 — gvYourGift exists in PHP, the English catalogue and the compiled catalogue', () => {
  assert.match(php, /'gvYourGift'\s*=> __\('Votre cadeau'/);
  assert.match(po, /msgid "Votre cadeau"\nmsgstr "Your gift"/);
  assert.ok(mo.includes('Your gift'), 'the .mo must be rebuilt with msgfmt');
});

test('rule 63 — the switcher honours prefers-reduced-motion and keeps a visible focus ring', () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.gf-gv-switch-opt \{ transition: none; \}\s*\.gf-gv-switch-opt:active \{ transform: none; \}/);
  assert.match(css, /\.gf-gv-switch-opt:focus-visible/);
  assert.match(css, /\.gf-gv-switch-opt\[aria-current="true"\]/);
});
