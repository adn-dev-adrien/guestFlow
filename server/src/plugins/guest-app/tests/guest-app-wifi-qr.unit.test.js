// specs/guest-app.md rule 18 `wifi`, reading of 2026-11-10 (audit R36-INJ-L1) — the join QR escapes every character the
// WIFI: scheme reserves, the backslash included: a password with a backslash read back wrong and the phone failed to
// join. The auditor's reader (ZXing's rule: a backslash escapes the next character, `;` ends a field) reads back what
// was typed.
const test = require('node:test');
const assert = require('node:assert/strict');

const { wifiPayload } = require('../controllers/sessionController');

/** A phone's reading of one field of a WIFI: payload. */
function readField(payload, name) {
  const start = payload.indexOf(`;${name}:`) >= 0 ? payload.indexOf(`;${name}:`) + name.length + 2 : -1;
  let out = '';
  for (let i = start; i < payload.length; i += 1) {
    if (payload[i] === '\\') { i += 1; out += payload[i] || ''; } else if (payload[i] === ';') break; else out += payload[i];
  }
  return out;
}

test('rule 18 reading: the wifi join text reads back the password and the network as typed (the auditor’s cases)', () => {
  ['pa\\ss', 'abc\\', 'C:\\x;y', 'a;b', 'a,b:"c"', 'plain'].forEach((password) => {
    const payload = wifiPayload({ network: 'Gîte \\ Solio;5G', password });
    assert.equal(readField(payload, 'P'), password, payload);
    assert.equal(readField(payload, 'S'), 'Gîte \\ Solio;5G', payload);
  });
  assert.equal(wifiPayload({ network: 'Open', password: '' }), 'WIFI:T:nopass;S:Open;P:;;');
});
