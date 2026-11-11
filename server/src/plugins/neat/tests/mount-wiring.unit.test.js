// specs/plugins-phase-0-foundation.md — what the core test used to read from this plugin's sources.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { createNeatController } = require('../controller');

test('/api/neat comes from the neat plugin (phase 3b rule 8)', () => {
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8'), /ctx\.mount\('\/api\/neat', buildRouter\(controller\)\)/);
});

test('Neat: an inactive plugin skips the pass, including the kicks from the payment flows', async () => {
  const neat = createNeatController({ pluginActive: () => false });
  assert.deepEqual(await neat.runPass('kick'), { skipped: 'plugin-inactive' });
});
