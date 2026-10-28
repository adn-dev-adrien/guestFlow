/**
 * Who manages the plugins of this space (specs/plugin-operator-provisioning.md rules 1, 2, 15, 21).
 * Pure: the environment and the licence reader are passed in.
 *
 *   operatorManaged({ env, licence })  true when the hosting sets GUESTFLOW_MANAGED=1 or the licence
 *                                      carries `activePlugins`; neither can be moved from inside the space
 *   desiredPlugins(licence)            the ids the operator wants running — `activePlugins` ∩ `plugins` —
 *                                      or null when the licence says nothing (the stored states stand)
 *   pendingEraseOrders(licence)        [{ order, id }] the licence carries (rule 23)
 */

function operatorManaged({ env = process.env, licence } = {}) {
  if (env.GUESTFLOW_MANAGED === '1') return true;
  return Boolean(licence) && licence.activePlugins() !== null;
}

function desiredPlugins(licence) {
  const active = licence.activePlugins();
  if (active === null) return null;
  return [...new Set(active)].filter((id) => licence.allowsPlugin(id));
}

function pendingEraseOrders(licence) {
  return licence.eraseOrders();
}

const defaultLicence = () => require('./licence').default;

module.exports = {
  operatorManaged,
  desiredPlugins,
  pendingEraseOrders,
  isOperatorManaged: () => operatorManaged({ licence: defaultLicence() }),
};
