/**
 * specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rule 11, K1 — the connector forwards every key the public voucher order and price routes read,
 * the period included (a key the proxy does not list never reaches GuestFlow: the website then always priced the cheapest period).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const proxy = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'integrations', 'wordpress', 'guestflow-booking', 'includes', 'class-gf-rest-proxy.php'), 'utf8');
const controller = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'gift-vouchers', 'controllers', 'publicOrdersController.js'), 'utf8');

const requestKeys = () => {
  const found = /const REQUEST_KEYS = Object\.freeze\(\[([^\]]*)\]\)/.exec(controller);
  assert.ok(found, 'REQUEST_KEYS not found in publicOrdersController');
  return found[1].split(',').map((k) => k.trim().replace(/'/g, '')).filter(Boolean);
};

const methodBody = (name) => {
  const start = proxy.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} not found`);
  return proxy.slice(start, proxy.indexOf('\n    }\n', start));
};

for (const method of ['post_voucher_order', 'post_voucher_price']) {
  test(`${method} forwards every key of the public request`, () => {
    const body = methodBody(method);
    for (const key of requestKeys()) assert.ok(new RegExp(`'${key}'\\s*=>`).test(body), `${method} drops « ${key} »`);
  });
}
