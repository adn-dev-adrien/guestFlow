// specs/plugins-phase-0-foundation.md — what the core test used to read from this plugin's sources.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test("Qonto's own routes come from the plugin (phase 3a rules 5, 11)", () => {
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8'), /ctx\.mount\('\/api\/payments', router\)/);
});
