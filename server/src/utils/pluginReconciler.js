/**
 * Brings the space's plugins to the operator's choice (specs/plugin-operator-provisioning.md rules
 * 16–19, 23). `planSteps` is pure; `createReconciler` takes its effects as dependencies so the unit
 * suites run it on an in-memory database with no HTTP round-trip.
 *
 *   deps.licence      the licence reader (`activePlugins`, `eraseOrders`, `issuedAt`, `allowsPlugin`)
 *   deps.model        pluginsModel     — the stored states
 *   deps.provisioning pluginProvisioningModel
 *   deps.controller   pluginsController — install / activate / deactivate / uninstall handlers
 *   deps.catalogue    [{ id, requires: [{ id }] }] in catalogue order
 *   deps.now          () → Date
 */

const { capture } = require('./captureHandler');
const { desiredPlugins, pendingEraseOrders } = require('./pluginGovernance');

const BLOCKED_RETRY_MS = 60 * 60 * 1000;
// How far ahead of the space's own clock a licence may be dated and still count as the newest (rule 33).
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const BLOCKED_CODES = new Set(['PLUGIN_BLOCKED', 'REQUIRED_BY']);
const TRANSIENT_CODES = new Set(['UPDATE_IN_PROGRESS', 'RESTART_PENDING']);

/**
 * → ordered steps [{ op: 'deactivate' | 'install' | 'activate', id }]. Deactivations first, a plugin
 * before the ones it requires; then activations and installs, requirements first.
 */
function planSteps({ desired, states, requires, order }) {
  const wanted = new Set(desired);
  const requiresOf = (id) => (requires[id] || []).filter((r) => order.includes(r));
  const visit = (ids, next) => {
    const seen = new Set();
    const out = [];
    const walk = (id) => {
      if (seen.has(id)) return;
      seen.add(id);
      next(id).filter((n) => ids.includes(n)).forEach(walk);
      out.push(id);
    };
    ids.forEach(walk);
    return out;
  };
  const off = order.filter((id) => states[id] === 'active' && !wanted.has(id));
  const on = order.filter((id) => wanted.has(id) && states[id] !== 'active');
  const dependantsOf = (id) => off.filter((o) => requiresOf(o).includes(id));
  return [
    ...visit(off, dependantsOf).map((id) => ({ op: 'deactivate', id })),
    ...visit(on, requiresOf).map((id) => ({ op: states[id] ? 'activate' : 'install', id })),
  ];
}

function createReconciler({
  licence, model, provisioning, controller, catalogue, now = () => new Date(), coreVersion = () => require('./appVersion').getAppVersion(),
}) {
  const order = catalogue.map((p) => p.id);
  const catalogueRequires = Object.fromEntries(catalogue.map((p) => [p.id, (p.requires || []).map((r) => r.id)]));
  let running = false;

  // The stored manifest of an installed plugin (a registry version) wins over the catalogue's. A plugin
  // the licence does not allow is not looked at: its stored state stands, so a plan that takes it back
  // finds it as it was (rule 21).
  const readState = () => {
    const states = {};
    const requires = { ...catalogueRequires };
    model.list().filter((r) => licence.allowsPlugin(r.id)).forEach((r) => {
      states[r.id] = r.enabled ? 'active' : 'inactive';
      if (r.manifest && r.manifest.requires) requires[r.id] = r.manifest.requires.map((x) => x.id);
    });
    return { states, requires };
  };

  const call = (op, id) => {
    const handler = { install: controller.install, activate: controller.activate, deactivate: controller.deactivate }[op];
    return capture(handler, { params: { id }, query: {}, body: {}, noRestart: true, reconciling: true });
  };

  // → null when the step must be tried again later without a trace, else { outcome, code, message }.
  async function execute(step) {
    const { status, body } = await call(step.op, step.id);
    if (status >= 200 && status < 300) return { outcome: 'applied' };
    const code = (body && body.error) || 'FAILED';
    if (TRANSIENT_CODES.has(code)) return null;
    const message = (body && body.message) || 'Échec de l’application.';
    if (step.op === 'deactivate' && BLOCKED_CODES.has(code)) return { outcome: 'blocked', code: (body && body.code) || code, message };
    return { outcome: 'failed', code, message };
  }

  // A step is skipped while its last attempt for the same licence stands: a failure waits for a new
  // licence (rule 18), a business blocker for the hour (rule 19).
  function settled(prior, wantedState, issuedAt) {
    if (!prior || prior.desired !== wantedState || prior.licenceIssuedAt !== issuedAt) return false;
    if (prior.outcome === 'failed') return true;
    if (prior.outcome === 'blocked') return now().getTime() - Date.parse(prior.at) < BLOCKED_RETRY_MS;
    return false;
  }

  async function eraseOrders(issuedAt, wantedSet) {
    for (const { order: orderId, id, removal } of pendingEraseOrders(licence)) {
      const row = model.get(id);
      if (provisioning.erased(orderId) || !order.includes(id)) continue;
      if (wantedSet.has(id)) continue;
      if (!row) { provisioning.markErased(orderId, now().toISOString()); continue; }
      if (row.enabled) continue;
      if (settled(provisioning.get(id), 'inactive', issuedAt)) continue;
      // A removal order (`removal: true`) is the console's « Désinstaller » of a module it showed with no
      // data to lose: it never purges, whatever the plugin keeps (rule 40).
      const query = removal === true ? {} : { purge: '1' };
      let answer = await capture(controller.uninstall, { params: { id }, query, body: {}, reconciling: true }); // eslint-disable-line no-await-in-loop
      // A plugin that keeps no data has nothing to erase: the order is settled by leaving it uninstalled.
      if (removal !== true && answer.body && answer.body.error === 'NOT_ERASABLE') {
        answer = await capture(controller.uninstall, { params: { id }, query: {}, body: {}, reconciling: true }); // eslint-disable-line no-await-in-loop
      }
      const { status, body } = answer;
      const at = now().toISOString();
      if (status >= 200 && status < 300) {
        provisioning.markErased(orderId, at);
        provisioning.record({ pluginId: id, desired: 'inactive', outcome: 'applied', licenceIssuedAt: issuedAt, at, eraseOrder: orderId });
      } else if (!TRANSIENT_CODES.has(body && body.error)) {
        provisioning.record({
          pluginId: id, desired: 'inactive', outcome: BLOCKED_CODES.has(body && body.error) ? 'blocked' : 'failed',
          code: (body && body.code) || (body && body.error) || 'FAILED', message: (body && body.message) || (removal === true ? 'Échec de la désinstallation.' : 'Échec de l’effacement.'),
          licenceIssuedAt: issuedAt, at,
        });
      }
    }
  }

  // What the console reads back but cannot compute (rules 14, 22): the setup a plugin still lacks and
  // the data it would erase. Published for every installed plugin, dropped for the others.
  function publishFacts() {
    try {
      provisioning.setCapabilities({ removalOrders: true, coreVersion: coreVersion() });
      controller.views().forEach((view) => {
        const installed = view.state !== 'available';
        provisioning.setFacts(view.id, installed
          ? {
            setup: view.setup.needed ? view.setup.missing : null, erasable: view.erasable, data: view.data, ...(view.dataUnknown ? { dataUnknown: true } : {}),
          }
          : null);
      });
    } catch (err) {
      console.error('[plugins] facts for the console:', err && err.message ? err.message : err);
    }
  }

  /** One pass. Returns { skipped: true } when the licence says nothing, else the steps taken. */
  async function run() {
    if (running) return { skipped: true, reason: 'busy' };
    const desired = desiredPlugins(licence);
    const issuedAt = licence.issuedAt();
    if (desired === null || !issuedAt) return { skipped: true, reason: 'no desire' };
    // Rule 33 — an older licence put back in place (a restored backup, a replayed file) never undoes a newer choice.
    const highest = provisioning.highestIssuedAt();
    if (highest && Date.parse(issuedAt) < Date.parse(highest)) return { skipped: true, reason: 'older licence' };
    running = true;
    try {
      // A licence dated beyond the clock's tolerance is applied but never becomes the mark: it would shut out every honest licence.
      const ahead = Date.parse(issuedAt) > now().getTime() + CLOCK_SKEW_MS;
      if (!ahead && issuedAt !== highest) provisioning.setHighestIssuedAt(issuedAt);
      const wantedSet = new Set(desired);
      const { states, requires } = readState();
      const steps = planSteps({ desired, states, requires, order });
      const taken = [];
      let complete = true;
      for (const step of steps) {
        const wantedState = step.op === 'deactivate' ? 'inactive' : 'active';
        if (settled(provisioning.get(step.id), wantedState, issuedAt)) continue;
        const result = await execute(step); // eslint-disable-line no-await-in-loop
        if (!result) { complete = false; continue; }
        provisioning.record({
          pluginId: step.id, desired: wantedState, outcome: result.outcome, code: result.code || null,
          message: result.message || null, licenceIssuedAt: issuedAt, at: now().toISOString(),
        });
        taken.push({ ...step, outcome: result.outcome });
      }
      // An erase order still on its way keeps its own failure on record.
      const handled = new Set([
        ...steps.map((s) => s.id),
        ...pendingEraseOrders(licence).filter((o) => !provisioning.erased(o.order)).map((o) => o.id),
      ]);
      order.filter((id) => licence.allowsPlugin(id)).forEach((id) => {
        const prior = provisioning.get(id);
        if (!prior || prior.outcome === 'applied' || handled.has(id)) return;
        provisioning.record({
          pluginId: id, desired: wantedSet.has(id) ? 'active' : 'inactive', outcome: 'applied',
          licenceIssuedAt: issuedAt, at: now().toISOString(),
        });
      });
      publishFacts();
      await eraseOrders(issuedAt, wantedSet);
      if (complete) provisioning.setAppliedLicence(issuedAt);
      return { skipped: false, steps: taken };
    } finally {
      running = false;
    }
  }

  return { run };
}

module.exports = { planSteps, createReconciler, BLOCKED_RETRY_MS };
