/**
 * specs/booking-drawer-friction.md — the WordPress side (plugin + Solio drawer).
 *
 * This is PHP and browser JavaScript, so nothing here executes it (the behaviour was verified end to
 * end, spec §10). What the suite can do is hold the shape that makes the rules true: the setting off
 * by default, the order of the blocks, the strings and their English, the hooks the drawer relies on.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const WP = path.join(__dirname, '..', '..', '..', 'integrations', 'wordpress');
const PLUGIN = path.join(WP, 'guestflow-booking');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

const view = read(PLUGIN, 'blocks', 'booking', 'view.js');
const blockJson = JSON.parse(read(PLUGIN, 'blocks', 'booking', 'block.json'));
const render = read(PLUGIN, 'blocks', 'booking', 'render.php');
const blocks = read(PLUGIN, 'includes', 'class-gf-blocks.php');
const po = read(PLUGIN, 'languages', 'guestflow-booking-en_GB.po');
const css = read(PLUGIN, 'assets', 'style.css');
const drawer = read(WP, 'solio-site', 'mu-plugins', 'gf-seo-reservation.php');

/** The French source string of an i18n key in class-gf-blocks.php. */
function source(key) {
  const m = new RegExp(`'${key}'\\s*=>\\s*__\\('((?:[^'\\\\]|\\\\.)*)'`).exec(blocks);
  assert.ok(m, `i18n key ${key} is declared`);
  return m[1];
}
function translated(fr) {
  const i = po.indexOf(`msgid "${fr}"`);
  assert.ok(i >= 0, `« ${fr} » has an English entry`);
  const msgstr = /msgstr "([^"]*)"/.exec(po.slice(i));
  assert.ok(msgstr && msgstr[1], `« ${fr} » is translated`);
  return msgstr[1];
}

test('rule 1 — the request-without-paying setting exists, is off by default, and only rides with payOnline', () => {
  assert.deepEqual(blockJson.attributes.offerRequest, { type: 'boolean', default: false });
  assert.match(render, /\$offer_request = \$pay_online && !empty\(\$attributes\['offerRequest'\]\);/);
  assert.match(render, /data-offer-request=/);
  assert.match(view, /var offerRequest = payOnline && container\.dataset\.offerRequest === '1';/);
});

test('rules 2 + 4 — two actions: the amount on the primary, the request on a secondary, with its hint', () => {
  assert.match(view, /class: 'gf-btn gf-btn-alt'/);
  assert.match(view, /submit\('request'\)/);
  assert.match(view, /GF\.t\('payAmount', /);
  assert.match(view, /GF\.t\('payDepositAmount', /);
  assert.equal(source('sendRequestNoPay'), 'Envoyer une demande sans payer');
  assert.match(source('requestNoPayHint'), /aucun paiement tant que nous n’avons pas répondu/);
  for (const key of ['sendRequestNoPay', 'requestNoPayHint', 'payAmount', 'payDepositAmount']) translated(source(key));
});

test('rule 6 — booking-requested says which action was taken', () => {
  assert.match(view, /GF\.track\('booking-requested', \{[^}]*mode: pays \? 'pay' : 'request'/);
});

test('rule 7 — the travellers block comes before the calendar', () => {
  const form = /var form = GF\.el\('div', \{ class: 'gf-booking' \},[\s\S]*?\n\s+(guestsBox, calBox[^)]*)\)/.exec(view);
  assert.ok(form, 'the form is assembled with guestsBox first');
});

test('rule 9 — the price per person is drawn from the server value, never computed', () => {
  assert.match(view, /if \(q\.perPersonPerNight != null\)/);
  assert.match(view, /GF\.t\('perPersonPerNight', GF\.euro\(q\.perPersonPerNight\)\)/);
  translated(source('perPersonPerNight'));
});

test('rules 11-12 — short departures are hatched, refused on tap, and the earliest departure is named', () => {
  assert.match(view, /if \(short\) cls \+= ' gf-short';/);
  assert.match(view, /if \(isShortDeparture\(ds\)\) \{/);
  assert.match(view, /GF\.t\('minNightsPick', /);
  assert.match(view, /GF\.t\('minNightsFrom', /);
  assert.match(css, /button\.gf-cal-day\.gf-short \{/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{ button\.gf-cal-day\.gf-shake \{ animation: none; \}/);
  for (const key of ['minShort', 'minNightsFrom', 'minNightsPick']) translated(source(key));
  // The placeholders keep their order in English: the date is a %s, the count a %d.
  assert.equal(translated(source('minNightsPick')), '%d nights minimum: choose %s or later.');
});

test('rule 17 — the off-screen step of the drawer is inert', () => {
  assert.match(drawer, /ecrans\.forEach\( function \( ecran, i \) \{ ecran\.inert = \( i !== etape - 1 \); \} \);/);
});

test('rule 20 — the theme section padding is reset inside the drawer', () => {
  assert.match(drawer, /\.gf-resa-panneau \.gf-section \{ max-width: none; margin: 0 0 18px; padding: 0; \}/);
});
