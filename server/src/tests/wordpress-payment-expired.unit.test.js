// specs/payment-link-lifecycle.md rule 30 and specs/wordpress-plugin.md rule 34 — the return page's
// `expired` message exists in French and in English, in the catalogue and in the compiled .mo the site
// loads, and ships in plugin 1.19.0. The browser behaviour is pinned by the client suite
// wordpress-booking-view.payment-expired.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PLUGIN = path.join(__dirname, '..', '..', '..', 'integrations', 'wordpress', 'guestflow-booking');
const read = (rel) => fs.readFileSync(path.join(PLUGIN, rel));

const FR = 'Ce lien de paiement a expiré. Refaire la réservation depuis la page du logement.';
const EN = "This payment link has expired. Please book again from the accommodation's page.";

test('rule 30 — the expiry message is localized under the key the view reads', () => {
  const blocks = read('includes/class-gf-blocks.php').toString('utf8');
  assert.ok(blocks.includes(`'paymentExpired'  => __('${FR}', 'guestflow-booking')`));
  assert.match(read('blocks/booking/view.js').toString('utf8'), /d\.status === 'expired'[\s\S]{0,200}GF\.t\('paymentExpired'\)[\s\S]{0,40}return;/);
});

test('rule 30 — the English translation is in the catalogue and in the compiled .mo', () => {
  const po = read('languages/guestflow-booking-en_GB.po').toString('utf8');
  assert.ok(po.includes(`msgid "${FR}"\nmsgstr "${EN}"`));
  const mo = read('languages/guestflow-booking-en_GB.mo');
  assert.ok(mo.includes(Buffer.from(FR, 'utf8')), 'msgid compiled');
  assert.ok(mo.includes(Buffer.from(EN, 'utf8')), 'msgstr compiled');
});

test('rule 30 — the plugin that understands `expired` is 1.19.0, everywhere it names its version', () => {
  const php = read('guestflow-booking.php').toString('utf8');
  const readme = read('readme.txt').toString('utf8');
  assert.match(php, /\* Version:\s+1\.19\.0\b/);
  assert.match(php, /define\('GF_BOOKING_VERSION', '1\.19\.0'\)/);
  assert.match(readme, /^Stable tag: 1\.19\.0$/m);
  assert.match(readme, /= 1\.19\.0 =\n\* Page de retour du paiement : quand le lien de paiement a expiré/);
});
