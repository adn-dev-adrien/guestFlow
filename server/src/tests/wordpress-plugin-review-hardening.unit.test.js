// specs/wordpress-plugin-self-update.md rule 6, specs/wordpress-plugin.md rule 14 and
// specs/public-online-payment.md rule 2 — WordPress plugin 1.16.1: the update package must come from
// GuestFlow's own releases, a fully trusted X-Forwarded-For chain never relays its client-written
// left-most hop, and the payment redirect only follows an https URL. The plugin has no PHP harness,
// so the PHP rules are read from the source and the redirect guard is run from view.js itself.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const WP = path.join(__dirname, '..', '..', '..', 'integrations', 'wordpress');
const PLUGIN = path.join(WP, 'guestflow-booking');
const read = (file) => fs.readFileSync(path.join(PLUGIN, file), 'utf8');

function packagePattern() {
  const src = read('includes/class-gf-updater.php');
  const prefix = src.match(/PACKAGE_PREFIX = '([^']+)'/)[1];
  const tail = src.match(/preg_quote\(self::PACKAGE_PREFIX, '#'\) \. '([^']+)\$#'/)[1];
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  return { src, re: new RegExp(`^${escaped}${tail}$`) };
}

test('rule 6: the update package path is a guestflow-booking asset of a GuestFlow release', () => {
  const { src, re } = packagePattern();
  assert.match(src, /!== 'github\.com'/, 'github.com is the only host');
  assert.doesNotMatch(src, /githubusercontent/, 'the storage hosts name no repository');
  assert.ok(re.test('/adn-dev-adrien/guestFlow/releases/download/v3.14.0/guestflow-booking-1.16.1.zip'));
  for (const bad of [
    '/someone-else/guestFlow/releases/download/v3.14.0/guestflow-booking-1.16.1.zip',
    '/adn-dev-adrien/other/releases/download/v3.14.0/guestflow-booking-1.16.1.zip',
    '/adn-dev-adrien/guestFlow/raw/master/guestflow-booking-1.16.1.zip',
    '/adn-dev-adrien/guestFlow/releases/download/v3.14.0/../x/guestflow-booking-1.16.1.zip',
    '/adn-dev-adrien/guestFlow/releases/download/v3.14.0/evil.zip',
  ]) {
    assert.equal(re.test(bad), false, bad);
  }
});

test('rule 14: a fully trusted X-Forwarded-For chain falls back to the connecting address', () => {
  const src = read('includes/class-gf-api-client.php');
  const body = src.slice(src.indexOf('function visitor_ip'), src.indexOf('function is_local_ip'));
  assert.doesNotMatch(body, /\$hops\[0\]/, 'the left-most hop is client-controlled');
  assert.match(body, /foreach \(array_reverse\(\$hops\)[\s\S]*?\}\s*\}\s*[^}]*return filter_var\(\$remote/);
});

test('rule 2: the payment redirect only follows an https URL', () => {
  const src = read('blocks/booking/view.js');
  const fn = src.match(/function isHttpsUrl\(url\) \{[\s\S]*?\n {4}\}/)[0];
  const isHttpsUrl = new Function(`${fn}; return isHttpsUrl;`)();
  assert.equal(isHttpsUrl('https://pay.qonto.com/abc'), true);
  for (const bad of ['javascript:alert(1)', 'http://pay.example.com', 'data:text/html,x', '//evil.example', '', null, 42]) {
    assert.equal(isHttpsUrl(bad), false, String(bad));
  }
  assert.match(src, /isHttpsUrl\(res\.body\.data\.paymentUrl\)[\s\S]{0,400}window\.location\.href = res\.body\.data\.paymentUrl/);
});

test('INSTALL.md never tells the operator to switch off TLS verification', () => {
  const install = fs.readFileSync(path.join(WP, 'INSTALL.md'), 'utf8');
  assert.doesNotMatch(install, /curl -k\b|curl -sk\b|--insecure/);
});
