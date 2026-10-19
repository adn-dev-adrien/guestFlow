// specs/plugins-phase-p-productisation.md rule 30 — a deployment's private material stays out of the
// product repository. Domaine Solio's site, its tariff script and its deployment notes left on
// 2026-10-19; this guards against them, or their likes, coming back by habit.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

test('rule 30: the site material and the tariff script are gone from the tree', () => {
  assert.equal(exists('integrations/wordpress/solio-site'), false);
  assert.equal(exists('scripts/configure-aventura-lodge-2026.mjs'), false);
});

test('rule 30: the install guide documents the plugin, not one deployment', () => {
  const guide = fs.readFileSync(path.join(ROOT, 'integrations', 'wordpress', 'INSTALL.md'), 'utf8');
  assert.doesNotMatch(guide, /domainesolio|Domaine Solio|This deployment/i);
});

test('rule 30: no server test reads a deployment folder', () => {
  const dir = __dirname;
  const readers = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.js') && f !== path.basename(__filename))
    .filter((f) => fs.readFileSync(path.join(dir, f), 'utf8').includes("'solio-site'"));
  assert.deepEqual(readers, []);
});
