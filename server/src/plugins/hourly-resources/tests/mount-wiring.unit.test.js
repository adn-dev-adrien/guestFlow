// specs/plugins-phase-0-foundation.md — what the core test used to read from this plugin's sources.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('the external bookings and the planning cards come from the plugin (phase 3c rule 10, phase 2 rule 8)', () => {
  assert.match(read('index.js'), /ctx\.mount\('\/api\/resource-bookings', buildRouter\(controller\)\)/);
  assert.match(read('index.js'), /ctx\.route\('get', '\/api\/planning\/resource-cards'/);
});
