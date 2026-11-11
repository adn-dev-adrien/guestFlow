// specs/plugins-phase-0-foundation.md — what the core test used to read from this plugin's sources.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('the pay route of a booking request is refused without a payment provider', () => {
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'routes', 'bookingRequests.js'), 'utf8'), /'\/:id\/pay', paymentStartLimiter, requireOnlinePayment,/);
});
