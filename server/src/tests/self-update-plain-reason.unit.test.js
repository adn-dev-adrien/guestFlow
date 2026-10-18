const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');

const { selfUpdateSupported } = require('../utils/deploymentPaths');

// specs/ds-components.md rule 25 — review #8, n-3: the « Système » card told the operator that the
// deployment « n'utilise pas le lien symbolique « current » ». The reason shown is what it means for
// them, not how the installer is laid out.
test('rule 25 — an install without the release layout reads « Mise à jour automatique indisponible »', () => {
  const missing = path.join(os.tmpdir(), `gf-no-such-deploy-${process.pid}`);
  const verdict = selfUpdateSupported({}, {
    currentLink: path.join(missing, 'current'),
    releasesDir: path.join(missing, 'releases'),
    ecosystemFile: path.join(missing, 'ecosystem.config.js'),
  });
  assert.deepEqual(verdict, { supported: false, reason: 'Mise à jour automatique indisponible sur cette installation.' });
  assert.doesNotMatch(verdict.reason, /symbolique|current/);
});
