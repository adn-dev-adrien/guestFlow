// specs/wordpress-plugin.md rule 17 — the blocks size their own boxes (border-box, scoped to
// `.gf-block`), so a stock theme no longer lets the inputs overflow their card. Rule 23 — in a narrow
// booking block the e-mail and « Effacer » take a whole row, and the CGV language switch is text.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PLUGIN = path.join(__dirname, '..', '..', '..', 'integrations', 'wordpress', 'guestflow-booking');
const css = fs.readFileSync(path.join(PLUGIN, 'assets', 'style.css'), 'utf8');

test('rule 17: border-box on the blocks and everything inside them, and nothing else', () => {
  assert.match(css, /\.gf-block, \.gf-block \*, \.gf-block \*::before, \.gf-block \*::after \{ box-sizing: border-box; \}/);
  assert.doesNotMatch(css, /(^|\})\s*\*\s*\{[^}]*box-sizing/, 'no global selector: the theme stays untouched');
  assert.match(css, /\.gf-field \{[^}]*min-width: 0;/);
});

test('rule 23: a narrow booking block gives the e-mail and « Effacer » a row each', () => {
  assert.match(css, /\.gf-booking \{ container-type: inline-size; \}/);
  const block = css.slice(css.indexOf('@container (max-width: 520px)'));
  assert.match(block, /\.gf-field-email \{ flex-basis: 100%; \}/);
  assert.match(block, /\.gf-field-clear \{ flex-basis: 100%; \}/);
});

test('rule 23: the CGV language switch is text, not flag emojis', () => {
  const shortcodes = fs.readFileSync(path.join(PLUGIN, 'includes', 'class-gf-shortcodes.php'), 'utf8');
  assert.doesNotMatch(shortcodes, /🇫🇷|🇬🇧/);
  assert.match(shortcodes, /data-lang="fr" lang="fr" aria-label="Français">FR</);
  assert.match(shortcodes, /data-lang="en" lang="en" aria-label="English">EN</);
});
