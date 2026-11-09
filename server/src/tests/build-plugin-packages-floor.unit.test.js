// specs/plugins-phase-4-registry.md rule 62 (D24, audit R34 L-T1) — the package build refuses a manifest
// whose `guestflow` range is anything but a floor: a ceiling would claim a refusal no core applies. The
// refusal comes before anything is staged in the output folder.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const manifestModule = require('../plugins/manifest');

test('rule 62 — buildPackage refuses a « <4.0.0 » ceiling, a caret range and an unreadable range, staging nothing', async () => {
  const { buildPackage } = await import(pathToFileURL(path.join(ROOT, 'scripts', 'build-plugin-packages.mjs')).href);
  const real = manifestModule.readSourceManifest;
  const id = 'airbnb-intake';
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-floor-'));
  try {
    for (const guestflow of ['>=3.18.0 <4.0.0', '^3.18.0', '<4.0.0', 'not a range']) {
      manifestModule.readSourceManifest = (pluginId, ...rest) => ({ ...real(pluginId, ...rest), guestflow });
      await assert.rejects(buildPackage(id, out), (err) => {
        assert.match(err.message, new RegExp(`plugin ${id}: "guestflow" range "${guestflow.replace(/[.^<>]/g, '\\$&')}" must be a floor`));
        return true;
      });
      assert.deepEqual(fs.readdirSync(out), [], guestflow);
    }
  } finally {
    manifestModule.readSourceManifest = real;
    fs.rmSync(out, { recursive: true, force: true });
  }
});
