/**
 * The space applies the operator's choice (specs/plugin-operator-provisioning.md rule 16): at boot
 * and then every minute. A pass whose licence carries no `activePlugins` does nothing. The hourly
 * retry of a blocked deactivation is the reconciler's own rule (rule 19), not another timer.
 */

const TICK_MS = 60 * 1000;
const BOOT_DELAY_MS = 5 * 1000;

function buildReconciler() {
  const licence = require('../utils/licence').default;
  const reconciler = require('../utils/pluginReconciler').createReconciler({
    licence,
    model: require('../models/pluginsModel'),
    provisioning: require('../models/pluginProvisioningModel').default,
    controller: require('../controllers/pluginsController'),
    catalogue: require('../constants/plugins').PLUGIN_CATALOG,
  });
  // The reader keeps a licence for a minute: the pass reads the file as it is, so a choice is applied
  // within a minute of the console writing it and not within two.
  return { run: () => { licence.invalidate(); return reconciler.run(); } };
}

function start({
  reconciler = buildReconciler(), setIntervalFn = setInterval, setTimeoutFn = setTimeout, loader = require('../plugins/loader'),
} = {}) {
  // The live set at boot is the baseline: nothing fires for it. After each reconcile (which re-reads the
  // licence) a plugin the licence now allows has turned live (specs/plugin-removal-resilience.md rule 17).
  loader.syncLiveTransitions();
  const pass = () => reconciler.run()
    .catch((err) => console.error('[plugins] provisioning:', err && err.message ? err.message : err))
    .then(() => loader.syncLiveTransitions());
  setIntervalFn(pass, TICK_MS);
  setTimeoutFn(pass, BOOT_DELAY_MS);
  return pass;
}

module.exports = { start, TICK_MS, BOOT_DELAY_MS };
