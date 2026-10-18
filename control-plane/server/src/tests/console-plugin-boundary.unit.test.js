// specs/plugins-phase-3a-online-payment.md rule 22 — the console never reaches inside a GuestFlow
// plugin: the Qonto library it shares with the instance is core code (`server/src/utils/qonto`). Moving
// or renaming a file of the online-payment plugin cannot break the console's billing.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..');
const GF_PLUGINS = path.join(__dirname, '..', '..', '..', '..', 'server', 'src', 'plugins');
const PLUGIN_IDS = fs.readdirSync(GF_PLUGINS).filter((d) => fs.existsSync(path.join(GF_PLUGINS, d, 'manifest.json')));

function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'tests' || e.name === 'node_modules' ? [] : sources(p);
    return e.name.endsWith('.js') ? [p] : [];
  });
}

test('rule 22 — no console file names a plugin folder of the instance', () => {
  assert.ok(PLUGIN_IDS.includes('online-payment'));
  const offenders = [];
  for (const file of sources(SRC)) {
    const text = fs.readFileSync(file, 'utf8');
    PLUGIN_IDS.forEach((id) => {
      if (new RegExp(`plugins['"/,\\s]+['"]?${id}\\b`).test(text)) offenders.push(`${path.relative(SRC, file)} → ${id}`);
    });
  }
  assert.deepEqual(offenders, []);
});

test('rule 22 — the shared Qonto modules are the core ones', () => {
  const gf = require('../utils/gf');
  const core = require(path.join(GF_PLUGINS, '..', 'utils', 'qonto'));
  assert.equal(gf.qontoService, core.qontoService);
  assert.equal(gf.qontoSettingsController, core.qontoSettingsController);
});
