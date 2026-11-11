// specs/wordpress-plugin.md rule 21 — `GET /public/v1/terms` with nothing published says whether a
// request would be refused (`details[0].bookingClosed`, the CGV requirement), so the site replaces the
// form instead of letting the visitor fill it. The code and status stay `503 TERMS_NOT_CONFIGURED`.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const fakeRes = () => ({
  statusCode: 200, body: null,
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.body = payload; return this; },
});

function controller(requireTermsAcceptance) {
  const orig = Module.prototype.require;
  Module.prototype.require = function patched(id) {
    if (id === '../../models/termsModel') return { getCurrent: () => null, getByVersion: () => null };
    return orig.call(this, id);
  };
  try {
    const settings = require('../settings');
    settings.bindStore({ get: (k) => (k === 'requireTermsAcceptance' ? (requireTermsAcceptance ? '1' : '0') : ''), set() {} });
    const m = '../controllers/publicTermsController';
    delete require.cache[require.resolve(m)];
    return require(m);
  } finally {
    Module.prototype.require = orig;
  }
}

test('rule 21: CGV required and none published → bookingClosed true', () => {
  const res = fakeRes();
  controller(true).getCurrent({}, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error.code, 'TERMS_NOT_CONFIGURED');
  assert.deepEqual(res.body.error.details, [{ bookingClosed: true }]);
});

test('rule 21: requirement lifted → bookingClosed false, the site keeps its form', () => {
  const res = fakeRes();
  controller(false).getCurrent({}, res);
  assert.deepEqual(res.body.error.details, [{ bookingClosed: false }]);
});
