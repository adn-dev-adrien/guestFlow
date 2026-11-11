/**
 * specs/site-english-version.md rule 43 — the booking calendar names its months in the page's
 * language.
 *
 * Kept from the former `solio-facts-bilingual` suite when the site's own mu-plugins left this
 * repository (phase P, §3.G): this assertion reads the public
 * `guestflow-booking` plugin, so it stays with it.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

test('the booking calendar has no frozen French month names (rule 43)', () => {
  const view = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'integrations', 'wordpress', 'guestflow-booking', 'blocks', 'booking', 'view.js'),
    'utf8',
  );
  assert.match(view, /Intl\.DateTimeFormat\(GF\.locale/, 'the calendar no longer reads the page locale');
  const frozen = ['janvier', 'février', 'décembre'].filter((m) => new RegExp(`'${m}'\\s*,`).test(view.replace(/fallback = \[[^\]]*\]/g, '')));
  assert.deepStrictEqual(frozen, [], 'French month names are frozen in the calendar again');
});
