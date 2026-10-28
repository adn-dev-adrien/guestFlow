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

// What the customer may run: the plan, the add-ons, and what is kept as grandfathered (rules 11–12).
function allowedPlugins(customer, plans, lowest) {
  return new Set([...pluginsOfPlan(customer.planCode, plans, lowest), ...customer.addons, ...customer.grandfathered]);
}

// `customer.modules` is the operator's choice — `{ chosen: [id], eraseOrders: [{ order, id }] }` —
// and is carried only once the choice has been seeded (specs/plugin-operator-provisioning.md rules
// 15, 25): a licence without it changes nothing on the space.
function buildPayload({ customer, state, plans, lowest, catalogueVersion, payUrl, now }) {
  const plan = plans.find((p) => p.code === customer.planCode);
  const allowed = allowedPlugins(customer, plans, lowest);
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
    ...(customer.modules ? {
      activePlugins: gfPlugins.PLUGIN_IDS.filter((id) => allowed.has(id) && customer.modules.chosen.includes(id)),
      eraseOrders: customer.modules.eraseOrders,
    } : {}),
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
  // → { written: true, path } | { written: false, reason } — the licence, or the support request of
  // specs/hosting-h2-account-security.md rule 12, which travels the same way.
  function writeFile(slug, fileName, token) {
    const dir = instances.dataDir(slug);
    if (!fs.existsSync(dir)) return { written: false, reason: `Dossier de l’instance introuvable (${dir}).` };
    const file = path.join(dir, fileName);
    const tmp = `${file}.${process.pid}.tmp`;
    // A directory the console cannot write (rights, full disk) is a failed step, never an
    // exception: the daily run must go on with the other customers.
    try {
      // The directory is the instance's: its data/ must not lead out of it, and a link planted at
      // the temporary name is removed, never followed (`wx`) — rule 21.
      const real = fs.realpathSync(dir);
      if (!real.startsWith(`${fs.realpathSync(instances.dirOf(slug))}${path.sep}`)) throw Object.assign(new Error('data/ hors du dossier'), { code: 'UNSAFE' });
      fs.rmSync(tmp, { force: true });
      fs.writeFileSync(tmp, token, { mode: 0o640, flag: 'wx' });
      fs.renameSync(tmp, file);
    } catch (err) {
      fs.rmSync(tmp, { force: true });
      return { written: false, reason: `Écriture impossible dans ${dir} (${err.code || err.message}).` };
    }
    return { written: true, path: file };
  }

  return {
    canSign: Boolean(privateKey),
    privateKey,
    sign: (payload) => gfLicence.signLicence(payload, privateKey),
    write: (slug, token) => writeFile(slug, gfLicence.FILE_NAME, token),
    writeFile,
  };
}

module.exports = { VALIDITY_DAYS, loadPrivateKey, pluginsOfPlan, allowedPlugins, buildPayload, createLicenceIssuer };
