/**
 * The « Modules » of a customer (specs/plugin-operator-provisioning.md rules 10–14, 22, 25): which
 * of the plugins the plan allows run on the customer's space. The choice is stored here, travels in
 * the signed licence, and the lines tell what the space reports back. Payloads are ready to render.
 */

const { allowedPlugins } = require('../utils/licenceIssuer');
const { moduleState, headerText } = require('../utils/moduleStates');
const { httpError } = require('../utils/httpError');
const { plugins: gfPlugins } = require('../utils/gf');

const OUT_OF_PLAN = 'Hors forfait : à ajouter au forfait ou en option d’abord.';
const UNREADABLE = 'Espace illisible : modules non relevés.';

const entryOf = (id) => gfPlugins.findPlugin(id);
const nameOf = (id) => (entryOf(id) || { name: id }).name;
const requiresOf = (id) => ((entryOf(id) || {}).requires || []).map((r) => r.id);

function createCustomerModulesController(ctx, customersController) {
  const { models, now, instances } = ctx;
  const { customers, catalogue, audit, customerPlugins, meta } = models;
  const day = () => customersController.today();

  const allowedOf = (c) => allowedPlugins(c, catalogue.plans(), catalogue.lowest());
  const catalogueOrder = (ids) => gfPlugins.PLUGIN_IDS.filter((id) => ids.has ? ids.has(id) : ids.includes(id));

  function planChip(id) {
    const lowest = catalogue.lowest()[id];
    const plan = lowest ? catalogue.plans().find((p) => p.code === lowest) : null;
    return plan ? `Forfait ${plan.name}` : 'Option à la carte';
  }

  function refusal(chosen, id, on) {
    if (on) {
      const off = requiresOf(id).filter((r) => !chosen.has(r));
      if (off.length) return httpError(422, 'REQUIREMENT_OFF', `Nécessite ${off.map(nameOf).join(', ')} : à activer d’abord.`);
      return null;
    }
    const dependants = [...chosen].filter((other) => requiresOf(other).includes(id));
    if (dependants.length) return httpError(422, 'REQUIRED_BY', `Nécessaire à ${dependants.map(nameOf).join(', ')} : à désactiver d’abord.`);
    return null;
  }

  // Rule 25 — the licence carries the choice only once it has been seeded.
  function licenceChoice(c) {
    if (!c.pluginsSeededAt) return null;
    return {
      chosen: customerPlugins.chosen(c.id),
      eraseOrders: customerPlugins.pendingOrders(c.id).map((o) => ({ order: o.orderId, id: o.pluginId })),
    };
  }

  function lineOf(c, id, { allowed, chosen, facts, writtenAt }) {
    const entry = entryOf(id);
    if (!allowed.has(id)) {
      return {
        id, name: entry.name, on: false, switchable: false, state: 'outOfPlan', stateLabel: null, detail: null,
        canRetry: false, canErase: false, eraseLines: [], planChip: planChip(id),
      };
    }
    const on = chosen.has(id);
    const state = moduleState({ id, on, facts, licenceWrittenAt: writtenAt, now: now() });
    return {
      id, name: entry.name, on, switchable: true, ...state, canErase: false, eraseLines: [], planChip: null,
    };
  }

  function view(customerId) {
    const c = customersController.mustGet(customerId);
    const seeded = Boolean(c.pluginsSeededAt);
    if (!seeded) {
      return {
        seeded: false, seedLabel: UNREADABLE, header: '', counts: { active: 0, toConfigure: 0, failed: 0, blocked: 0 }, included: [], outOfPlan: [],
      };
    }
    const allowed = allowedOf(c);
    const chosen = new Set(customerPlugins.chosen(c.id).filter((id) => allowed.has(id)));
    const facts = instances.readFacts(customersController.servedSlug(c));
    const writtenAt = meta.get(`licenceIssuedAt:${c.id}`);
    const lines = gfPlugins.PLUGIN_IDS.map((id) => lineOf(c, id, { allowed, chosen, facts, writtenAt }));
    const included = lines.filter((l) => l.switchable);
    const counts = {
      active: included.filter((l) => l.state === 'active').length,
      toConfigure: included.filter((l) => l.needsSetup).length,
      failed: included.filter((l) => l.state === 'failed').length,
      blocked: included.filter((l) => l.state === 'blocked').length,
    };
    return {
      seeded: true,
      seedLabel: null,
      header: headerText(counts),
      counts,
      empty: chosen.size === 0 ? 'Aucun module actif.' : null,
      included,
      outOfPlan: lines.filter((l) => !l.switchable),
    };
  }

  function toggle(customerId, pluginId, on, operator) {
    const c = customersController.mustGet(customerId);
    if (typeof on !== 'boolean') throw httpError(400, 'INVALID', 'Module : allumé ou éteint.');
    if (!entryOf(pluginId)) throw httpError(404, 'UNKNOWN_PLUGIN', 'Module inconnu.');
    if (c.archivedAt) throw httpError(409, 'ARCHIVED', 'Client archivé : réactivez-le d’abord.');
    if (!c.pluginsSeededAt) throw httpError(409, 'NOT_SEEDED', UNREADABLE);
    const allowed = allowedOf(c);
    if (!allowed.has(pluginId)) throw httpError(422, 'OUT_OF_PLAN', OUT_OF_PLAN);
    const chosen = new Set(customerPlugins.chosen(c.id).filter((id) => allowed.has(id)));
    if (chosen.has(pluginId) === on) return view(c.id);
    const refused = refusal(chosen, pluginId, on);
    if (refused) throw refused;
    if (on) customerPlugins.add(c.id, pluginId, day(), operator);
    else customerPlugins.remove(c.id, pluginId);
    customersController.journal(c.id, operator, 'module', `${nameOf(pluginId)} ${on ? 'activé' : 'désactivé'}`);
    customersController.issueLicence(c.id);
    return view(c.id);
  }

  // « Réessayer » and « Relever maintenant »: a new licence is a new attempt (rule 18).
  function retry(customerId, operator) {
    const c = customersController.mustGet(customerId);
    if (!c.pluginsSeededAt && !seedCustomer(c, operator)) throw httpError(409, 'NOT_SEEDED', UNREADABLE);
    customersController.issueLicence(c.id);
    return view(c.id);
  }

  // Rule 25 — from what the space runs now, before any licence carries `activePlugins`.
  function seedCustomer(c, operator = 'migration') {
    const facts = instances.readFacts(customersController.servedSlug(c));
    if (!facts) return false;
    const allowed = allowedOf(c);
    const running = catalogueOrder(facts.active).filter((id) => allowed.has(id));
    customerPlugins.replace(c.id, running, day(), 'migration');
    customerPlugins.markSeeded(c.id, now().toISOString());
    customersController.journal(c.id, operator, 'module', `Modules relevés sur l’espace : ${running.length} actif${running.length > 1 ? 's' : ''}`);
    customersController.issueLicence(c.id);
    return true;
  }

  function seedPending() {
    return customerPlugins.unseededIds().map((id) => customers.get(id)).filter(Boolean).filter((c) => seedCustomer(c)).length;
  }

  // Rule 13 — the modules a new customer starts with: the form's choice, else everything allowed.
  function creationChoices({ planCode, addons, requested, errors }) {
    const planRow = catalogue.plan(planCode);
    if (!planRow) return { choices: [], chosen: [] };
    const allowed = allowedPlugins(
      { planCode: planRow.code, addons, grandfathered: [] }, catalogue.plans(), catalogue.lowest(),
    );
    const allowedIds = catalogueOrder(allowed);
    let chosen = allowedIds;
    if (Array.isArray(requested)) {
      const asked = new Set(requested);
      if ([...asked].some((id) => !allowed.has(id))) errors.modules = OUT_OF_PLAN;
      chosen = allowedIds.filter((id) => asked.has(id));
      const wanted = new Set(chosen);
      const missing = chosen.find((id) => requiresOf(id).some((r) => !wanted.has(r)));
      if (missing && !errors.modules) errors.modules = `Nécessite ${requiresOf(missing).filter((r) => !wanted.has(r)).map(nameOf).join(', ')} : à activer d’abord.`;
    }
    const wanted = new Set(chosen);
    return {
      chosen,
      choices: allowedIds.map((id) => ({ id, name: nameOf(id), ticked: wanted.has(id), allowed: true })),
      summary: `${chosen.length} module${chosen.length > 1 ? 's' : ''} actif${chosen.length > 1 ? 's' : ''} à la création.`,
    };
  }

  function seedAtCreation(customerId, chosen, operator) {
    customerPlugins.replace(customerId, chosen, day(), operator);
    customerPlugins.markSeeded(customerId, now().toISOString());
  }

  // A plan or option change: what is no longer allowed leaves the choice (edge case, rule 11).
  function dropNotAllowed(customerId, operator) {
    const c = customers.get(customerId);
    if (!c.pluginsSeededAt) return [];
    const allowed = allowedOf(c);
    const dropped = customerPlugins.chosen(c.id).filter((id) => !allowed.has(id));
    dropped.forEach((id) => {
      customerPlugins.remove(c.id, id);
      customersController.journal(c.id, operator, 'module', `${nameOf(id)} retiré (hors forfait)`);
    });
    return dropped;
  }

  return { view, toggle, retry, seedCustomer, seedPending, licenceChoice, creationChoices, seedAtCreation, dropNotAllowed };
}

module.exports = { createCustomerModulesController };
