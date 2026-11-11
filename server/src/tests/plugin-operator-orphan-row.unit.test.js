// specs/plugin-operator-provisioning.md rule 39 — an installed plugin whose code is gone is outside the
// catalogue the reconciler walks: it is left as it is, and never breaks the pass.

const test = require('node:test');
const assert = require('node:assert/strict');

const { space } = require('./pluginOperatorFixture');

test('rule 39: the reconciler ignores an orphan row, whatever the licence says', async () => {
  const s = space({ installed: ['orphan-plugin'], managed: true, active: [] });
  s.model.setEnabled('orphan-plugin', true);
  const out = await s.reconciler.run();
  assert.ok(out === undefined || out === null || typeof out === 'object');
  assert.equal(s.model.get('orphan-plugin').enabled, true, 'neither deactivated nor uninstalled');
});
