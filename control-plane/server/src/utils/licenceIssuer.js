/**
 * Builds, signs and delivers a customer's licence (specs/control-plane-plans-and-access.md rule 9).
 * The format is the instance's own (`server/src/utils/licence.js`): the console signs with the
 * private key of rule 30, the instance verifies with the public one.
 *
 * Delivery: `<instance>/data/licence.jws`, written atomically (temp file + rename) so the instance
 * never reads half a licence. When that directory does not exist yet, the licence is still built and
 * can be downloaded from the customer's page.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { licence: gfLicence, plugins: gfPlugins } = require('./gf');

const VALIDITY_DAYS = 7;

function loadPrivateKey(base64Pkcs8) {
  if (!base64Pkcs8) return null;
  return crypto.createPrivateKey({ key: Buffer.from(base64Pkcs8, 'base64'), format: 'der', type: 'pkcs8' });
}

// The plugins a plan includes: every plugin whose lowest plan ranks at or below it.
function pluginsOfPlan(planCode, plans, lowest) {
  const rank = (code) => (plans.find((p) => p.code === code) || {}).rank;
  const r = rank(planCode);
  return gfPlugins.PLUGIN_IDS.filter((id) => lowest[id] && rank(lowest[id]) <= r);
}

function buildPayload({ customer, state, plans, lowest, catalogueVersion, payUrl, now }) {
  const plan = plans.find((p) => p.code === customer.planCode);
  const allowed = new Set([...pluginsOfPlan(customer.planCode, plans, lowest), ...customer.addons, ...customer.grandfathered]);
  const planOf = {};
  for (const id of gfPlugins.PLUGIN_IDS) {
    if (allowed.has(id) || !lowest[id]) continue;
    planOf[id] = plans.find((p) => p.code === lowest[id]).name;
  }
  return {
    slug: customer.slug,
    plan: plan.code,
    planName: plan.name,
    catalogueVersion,
    plugins: gfPlugins.PLUGIN_IDS.filter((id) => allowed.has(id)),
    planOf,
    quotas: { units: plan.maxUnits, users: plan.maxUsers },
    state,
    stateSince: customer.stateSince,
    endsAt: customer.trialEndsAt && state === 'trial' ? customer.trialEndsAt : customer.endsAt,
    payUrl: payUrl || null,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + VALIDITY_DAYS * 86400000).toISOString(),
  };
}

function createLicenceIssuer({ privateKey, instances }) {
  return {
    sign: (payload) => gfLicence.signLicence(payload, privateKey),

    // → { written: true, path } | { written: false, reason }
    write(slug, token) {
      const dir = instances.dataDir(slug);
      if (!fs.existsSync(dir)) return { written: false, reason: `Dossier de l’instance introuvable (${dir}).` };
      const file = path.join(dir, gfLicence.FILE_NAME);
      const tmp = `${file}.${process.pid}.tmp`;
      // A directory the console cannot write (rights, full disk) is a failed step, never an
      // exception: the daily run must go on with the other customers.
      try {
        fs.writeFileSync(tmp, token, { mode: 0o640 });
        fs.renameSync(tmp, file);
      } catch (err) {
        fs.rmSync(tmp, { force: true });
        return { written: false, reason: `Écriture impossible dans ${dir} (${err.code || err.message}).` };
      }
      return { written: true, path: file };
    },
  };
}

module.exports = { VALIDITY_DAYS, loadPrivateKey, pluginsOfPlan, buildPayload, createLicenceIssuer };
