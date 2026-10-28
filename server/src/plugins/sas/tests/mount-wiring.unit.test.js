// specs/plugins-phase-0-foundation.md — what the core test used to read from this plugin's sources.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('the SAS routes come from the sas module (phase 2 rule 8)', () => {
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8'), /ctx\.route\('get', '\/api\/reservations\/:id\/sas'/);
});
