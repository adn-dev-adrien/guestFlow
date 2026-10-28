/**
 * The space applies the operator's choice (specs/plugin-operator-provisioning.md rule 16): at boot
 * and then every minute. A pass whose licence carries no `activePlugins` does nothing. The hourly
 * retry of a blocked deactivation is the reconciler's own rule (rule 19), not another timer.
 */

const TICK_MS = 60 * 1000;
const BOOT_DELAY_MS = 5 * 1000;

function buildReconciler() {
  return require('../utils/pluginReconciler').createReconciler({
    licence: require('../utils/licence').default,
    model: require('../models/pluginsModel'),
    provisioning: require('../models/pluginProvisioningModel').default,
    controller: require('../controllers/pluginsController'),
    catalogue: require('../constants/plugins').PLUGIN_CATALOG,
  });
}

function start({ reconciler = buildReconciler(), setIntervalFn = setInterval, setTimeoutFn = setTimeout } = {}) {
  const pass = () => reconciler.run().catch((err) => console.error('[plugins] provisioning:', err && err.message ? err.message : err));
  setIntervalFn(pass, TICK_MS);
  setTimeoutFn(pass, BOOT_DELAY_MS);
  return pass;
}

module.exports = { start, TICK_MS, BOOT_DELAY_MS };
