// specs/wordpress-plugin.md rules 25-26 — the generic booking page (no lodging fixed on its block):
// the way back from the payment page shows that payment's status, never the lodging cards, and the
// page found automatically is never a lodging's own page. PHP, so the suite checks the shapes that
// carry it; the behaviour itself is exercised on a real WordPress (spec §7).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PLUGIN = path.join(__dirname, '..', '..', '..', 'integrations', 'wordpress', 'guestflow-booking');
const read = (file) => fs.readFileSync(path.join(PLUGIN, file), 'utf8');

test('rule 25: a booking block with no lodging renders its container on the payment return', () => {
  const render = read('blocks/booking/render.php');
  assert.match(render, /\$returning_from_payment = isset\(\$_GET\['gf_payment'\]\)/);
  assert.match(render, /if \(\$property_id <= 0 && !\$returning_from_payment\) \{\s*echo render_block\(\['blockName' => 'guestflow\/properties'/);
  assert.match(render, /data-gf-booking/);
});

test('rule 25: the return address keeps the lodging', () => {
  const view = read('blocks/booking/view.js');
  assert.match(view, /var returnPath = window\.location\.pathname \+ '\?property=' \+ propertyId \+ '&gf_payment=' \+ devisId/);
  // The status view comes before any lodging check.
  const init = view.slice(view.indexOf('function init(container)'));
  assert.ok(init.indexOf("queryParam('gf_payment')") < init.indexOf('!propertyId'));
});

test('rule 26: a booking block with its lodging fixed is never detected as the booking page', () => {
  const settings = read('includes/class-gf-settings.php');
  assert.match(settings, /'booking' => '"propertyId":'/);
  assert.match(settings, /post_content LIKE %s AND post_content NOT LIKE %s ORDER BY ID ASC LIMIT 1/);
  // The cache of the previous detection, which could hold a lodging page, is not reused.
  assert.match(settings, /DETECTED_TRANSIENT = 'gf_detected_pages_v2'/);
});
