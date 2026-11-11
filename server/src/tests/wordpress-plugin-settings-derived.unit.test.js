// specs/wordpress-plugin.md rule 14 — the WordPress settings ask for the URL and the key, and derive
// the rest: the property is picked by name from GuestFlow's list, the booking and CGV pages are found by
// their content or created, a reverse proxy on the local network is trusted without being listed, and
// the connection is tested on arrival. Rule 18: the test names a website booking switched off in
// GuestFlow instead of « Serveur injoignable ». PHP, so the suite checks the shapes that carry it; the
// behaviour itself is exercised on a real WordPress (spec §7).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PLUGIN = path.join(__dirname, '..', '..', '..', 'integrations', 'wordpress', 'guestflow-booking');
const read = (file) => fs.readFileSync(path.join(PLUGIN, file), 'utf8');
const settings = read('includes/class-gf-settings.php');
const client = read('includes/class-gf-api-client.php');

test('rule 14: the property is a select filled from GET /properties, with a typed fallback when unreachable', () => {
  assert.match(settings, /GF_Api_Client::instance\(\)->get\('\/properties'\)/);
  assert.match(settings, /<select name="<\?php echo esc_attr\(GF_BOOKING_OPTION\); \?>\[default_property_id\]"/);
  assert.match(settings, /count\(\$properties\) === 1/, 'a single property is pre-selected');
  assert.doesNotMatch(settings, /Logement par défaut \(ID\)/);
});

test('rule 14: both pages are pickers — automatic (found by content), a page, or « Créer la page »', () => {
  assert.match(settings, /'booking' => '<!-- wp:guestflow\/booking'/);
  assert.match(settings, /'cgv'\s+=> '\[guestflow_cgv\]'/);
  assert.match(settings, /render_page_select\('booking'/);
  assert.match(settings, /render_page_select\('cgv'/);
  assert.match(settings, /wp_insert_post\(/);
  // A second sanitize of the same save (WordPress does it for a new option) reuses the page.
  const create = settings.slice(settings.indexOf('private function sanitize_page_choice'));
  assert.ok(create.indexOf('detected_page($kind)') < create.indexOf('wp_insert_post('), 'the existing page is looked for first');
  // The detection cache is dropped whenever a page changes.
  assert.match(settings, /add_action\('save_post_page', \[\$this, 'forget_detected_pages'\]\)/);
});

test('rule 14: the readers fall back on the detected pages', () => {
  assert.match(settings, /public function get_booking_page_url\(\): string/);
  assert.match(read('blocks/properties/render.php'), /get_booking_page_url\(\)/);
  assert.match(read('includes/class-gf-blocks.php'), /'bookingPageUrl'\s+=> \$s->get_booking_page_url\(\)/);
  assert.match(read('blocks/booking/render.php'), /render_block\(\['blockName' => 'guestflow\/properties'/,
    'a booking page with no property lists the properties');
});

test('rule 14: a local proxy is trusted by default; the list is for a public one', () => {
  assert.match(settings, /'trust_local_proxies'\s+=> 1/);
  assert.match(client, /FILTER_FLAG_NO_PRIV_RANGE \| FILTER_FLAG_NO_RES_RANGE/);
  assert.match(client, /visitor_ip\(\$settings->get_trusted_proxies\(\), \$settings->trusts_local_proxies\(\)\)/);
  // No X-Forwarded-For → the address that connected, never an empty visitor IP.
  assert.match(client, /\$forwarded === '' \|\| !\$is_trusted\(\$remote\)/);
});

test('rule 14: the connection test runs on arrival once configured', () => {
  assert.match(settings, /<\?php if \(\$this->is_configured\(\)\) : \?>run\(\);<\?php endif; \?>/);
  assert.match(settings, /id="gf-test-result" role="status"/);
});

test('rule 18: PLUGIN_INACTIVE and a /public/v1 NOT_FOUND read as « module inactif »', () => {
  assert.match(settings, /\$error === 'PLUGIN_INACTIVE'/);
  assert.match(settings, /=== 404 && is_array\(\$error\) && \(\$error\['code'\] \?\? ''\) === 'NOT_FOUND'/);
  assert.match(settings, /Module « Réservation depuis le site » inactif dans GuestFlow\./);
  assert.match(read('assets/runtime.js'), /typeof res\.body\.error === 'string'\) return GF\.t\('unavailable'\)/);
});
