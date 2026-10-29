/**
 * The « Modules » of a customer (specs/plugin-operator-provisioning.md rules 10–14, 22, 25): which
 * of the plugins the plan allows run on the customer's space. The choice is stored here, travels in
 * the signed licence, and the lines tell what the space reports back. Payloads are ready to render.
 */

const crypto = require('crypto');
const { allowedPlugins } = require('../utils/licenceIssuer');
const { moduleState, headerText, headerParts } = require('../utils/moduleStates');
const { httpError } = require('../utils/httpError');
const { plugins: gfPlugins, pluginGraph } = require('../utils/gf');

const OUT_OF_PLAN = 'Hors forfait : à ajouter au forfait ou en option d’abord.';
const UNREADABLE = 'Espace illisible : modules non relevés.';
const DATA_UNKNOWN = 'Données non relevées : ni effacement ni désinstallation.';
const TOO_OLD = 'Espace à mettre à jour : modules non relevés.';

const entryOf = (id) => gfPlugins.findPlugin(id);
const nameOf = (id) => (entryOf(id) || { name: id }).name;
const requiresOf = (id) => ((entryOf(id) || {}).requires || []).map((r) => r.id);
const names = (ids) => ids.map(nameOf).join(', ');
const refs = (ids) => ids.map((id) => ({ id, name: nameOf(id) }));

// Rule 17 — the console reads the space's graph over the catalogue's manifests; its words for an
// unmet requirement are the switch's (« éteint »). `chosen` is the operator's choice, `allowed` the plan's.
function graphOf(allowed, chosen) {
  return pluginGraph.createGraph({
    manifests: Object.fromEntries(gfPlugins.PLUGIN_CATALOG.map((p) => [p.id, p])),
    states: Object.fromEntries([...allowed].map((id) => [id, chosen.has(id) ? 'active' : 'inactive'])),
    allows: (id) => allowed.has(id),
    nameOf,
    labels: { inactive: 'éteint' },
  });
}

/**
 * Rule 19 — a set of plugins a plan or an option composition allows is sound when every one of them has
 * its requirements in the set too. → the 422 sentence for the first that does not, or null.
 */
function compositionRefusal(ids) {
  const set = ids instanceof Set ? ids : new Set(ids);
  const broken = gfPlugins.PLUGIN_IDS.find((id) => set.has(id) && requiresOf(id).some((r) => !set.has(r)));
  if (!broken) return null;
  return httpError(422, 'REQUIREMENT_NOT_IN_PLAN', `${nameOf(broken)} nécessite ${names(requiresOf(broken).filter((r) => !set.has(r)))} : à inclure aussi.`);
}

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

  // Rule 18 — the modules a switch takes along, deepest first; without the operator's flag, the 422s of
  // rule 14 stay as they were.
  function followers(allowed, chosen, id, on) {
    const g = graphOf(allowed, chosen);
    return on ? g.requirementClosure(id).filter((r) => !chosen.has(r)) : g.activeDependantClosure(id);
  }

  // specs/plugin-dependencies.md rule 22 — the flag is the list of ids the operator saw; a different
  // closure now is refused, never taken along unseen.
  const confirmedIds = (given) => (Array.isArray(given) ? given : null);

  function refusal(allowed, chosen, id, on, { withRequirements, withDependents }) {
    const along = followers(allowed, chosen, id, on);
    if (!along.length) return null;
    const given = confirmedIds(on ? withRequirements : withDependents);
    if (on) {
      const unlicensed = along.filter((r) => !allowed.has(r));
      if (unlicensed.length) return httpError(422, 'REQUIREMENT_OFF', `Nécessite ${names(unlicensed)}, hors forfait.`);
      if (!given) return httpError(422, 'REQUIREMENT_OFF', `Nécessite ${names(along)} : à activer d’abord.`);
    } else if (!given) {
      return httpError(422, 'REQUIRED_BY', `Nécessaire à ${names(along)} : à désactiver d’abord.`);
    }
    const same = given.length === along.length && along.every((r) => given.includes(r));
    return same ? null : httpError(422, 'CONFIRMATION_STALE', 'La liste a changé : relire, puis confirmer à nouveau.');
  }

  // Rule 25 — the licence carries the choice only once it has been seeded.
  function licenceChoice(c) {
    if (!c.pluginsSeededAt) return null;
    return {
      chosen: customerPlugins.chosen(c.id),
      eraseOrders: customerPlugins.pendingOrders(c.id).map((o) => ({ order: o.orderId, id: o.pluginId, ...(o.removal ? { removal: true } : {}) })),
    };
  }

  // Rule 31 — an installed plugin that requires the module keeps it installed: the space would refuse.
  function erasureDependants(id, allowed, facts) {
    return (facts ? facts.installed : []).filter((other) => other !== id && allowed.has(other) && requiresOf(other).includes(id));
  }

  function erasureIssue(id, facts, writtenAt, removal) {
    const row = facts && facts.provisioning ? facts.provisioning.rows.find((r) => r.pluginId === id) : null;
    if (!row || row.desired !== 'inactive' || row.licenceIssuedAt !== writtenAt) return null;
    if (row.outcome === 'failed') return row.message;
    if (row.outcome === 'blocked') return `${removal ? 'Désinstallation bloquée' : 'Effacement bloqué'} : ${row.message}`;
    return null;
  }

  const keptData = (state, eraseLines) => (state.state === 'inactive' && eraseLines.length ? 'données conservées' : null);
  const installedOn = (facts, id) => Boolean(facts) && facts.installed.includes(id);

  function lineOf(c, id, { allowed, chosen, facts, writtenAt, erasing }) {
    const entry = entryOf(id);
    if (!allowed.has(id)) {
      return {
        requires: [], usedBy: [], alsoOn: [], alsoOff: [], switchBlockedBy: null, confirm: null,
        id, name: entry.name, on: false, switchable: false, state: 'outOfPlan', stateLabel: null, detail: null, setupLabel: null, stale: false, needsSetup: false,
        canRetry: false, canErase: false, canUninstall: false, blockedBy: null, eraseLines: [], eraseWarnings: [], planChip: planChip(id),
      };
    }
    const on = chosen.has(id);
    const state = moduleState({ id, on, facts, licenceWrittenAt: writtenAt, now: now() });
    // Rule 22 — only an inactive module with something to erase, and not while an order is on its way.
    const reported = facts && facts.provisioning ? facts.provisioning.moduleFacts[id] : null;
    // The plugin's own lines are { label, count, warning? }. A warning with a zero count is a note on what
    // stays; any other line — a warning on money included — is data the purge erases (rule 41).
    const dataLines = reported && reported.erasable && Array.isArray(reported.data) ? reported.data : [];
    const isNote = (l) => l.warning && l.count === 0;
    const eraseLines = dataLines.filter((l) => !isNote(l)).map((l) => l.label);
    // Rule 41 — a space that cannot say what the module holds gives no action: unknown is not « nothing ».
    const unknown = installedOn(facts, id) && (!reported || reported.dataUnknown === true || (reported.erasable && !Array.isArray(reported.data)));
    // Rules 31, 38 — a module that is off can be wiped (it holds data) or removed (it holds none) unless an installed plugin needs it.
    const idle = !on && state.state === 'inactive' && !erasing.has(id);
    const installed = installedOn(facts, id);
    const dependants = idle && !unknown && (eraseLines.length > 0 || installed) ? erasureDependants(id, allowed, facts) : [];
    const canErase = idle && !unknown && eraseLines.length > 0 && dependants.length === 0;
    const removalOrders = Boolean(facts && facts.provisioning && facts.provisioning.capabilities && facts.provisioning.capabilities.removalOrders === true);
    const canUninstall = idle && !unknown && removalOrders && eraseLines.length === 0 && installed && dependants.length === 0;
    const blockedBy = dependants.length ? `Nécessaire à ${dependants.map(nameOf).join(', ')} : à désinstaller d’abord.` : null;
    const g = graphOf(allowed, chosen);
    // A requirement the plan does not license cannot be switched on: said before the click, not after a confirmation.
    const along = followers(allowed, chosen, id, !on);
    const unlicensed = on ? [] : along.filter((r) => !allowed.has(r));
    const switchBlockedBy = unlicensed.length ? `Nécessite ${names(unlicensed)}, hors forfait.` : null;
    const confirm = on
      ? {
        title: `Désactiver ${entry.name} ?`,
        message: `${along.length ? `Désactive aussi : ${names(along)}. ` : ''}Ses pages disparaissent de l’espace ; ses données sont conservées.`,
        label: along.length ? 'Tout désactiver' : 'Désactiver',
      }
      : (along.length && !switchBlockedBy ? { title: `Activer ${entry.name} ?`, message: `Active aussi : ${names(along)}.`, label: 'Tout activer' } : null);
    return {
      requires: g.requirementsOf(id).map(({ id: rid, name, status, label }) => ({ id: rid, name, status, label })),
      usedBy: g.usedBy(id).map((d) => ({ ...d, label: d.state === 'active' ? d.name : `${d.name} (éteint)` })),
      alsoOn: switchBlockedBy || on ? [] : refs(along),
      alsoOff: on ? refs(along) : [],
      switchBlockedBy,
      confirm,
      id, name: entry.name, on, switchable: true, ...state,
      detail: erasing.has(id) ? erasureIssue(id, facts, writtenAt, erasing.get(id)) || (erasing.get(id) ? 'Désinstallation en cours.' : 'Effacement des données en cours.') : blockedBy || state.detail || (idle && unknown ? DATA_UNKNOWN : keptData(state, eraseLines)),
      canErase, canUninstall, blockedBy, eraseLines: canErase ? eraseLines : [], eraseWarnings: canErase ? dataLines.filter(isNote).map((l) => l.label) : [], planChip: null,
    };
  }

  // Rule 19 — the options chosen on top of a plan must bring the requirements of what they add.
  function refuseComposition(planCode, addons) {
    return compositionRefusal(allowedPlugins({ planCode, addons, grandfathered: [] }, catalogue.plans(), catalogue.lowest()));
  }

  // A readable space on a release before the reconciler is not « illisible »: it only needs the update.
  function unseededLabel(c) {
    const facts = instances.readFacts(customersController.servedSlug(c));
    return facts && !facts.provisioning ? TOO_OLD : UNREADABLE;
  }

  function view(customerId) {
    const c = customersController.mustGet(customerId);
    const seeded = Boolean(c.pluginsSeededAt);
    if (!seeded) {
      return {
        seeded: false, seedLabel: unseededLabel(c), header: '', headerParts: [], counts: { active: 0, toConfigure: 0, failed: 0, blocked: 0 }, included: [], outOfPlan: [],
      };
    }
    const allowed = allowedOf(c);
    const chosen = new Set(customerPlugins.chosen(c.id).filter((id) => allowed.has(id)));
    const facts = instances.readFacts(customersController.servedSlug(c));
    const writtenAt = meta.get(`licenceIssuedAt:${c.id}`);
    const erasing = new Map(customerPlugins.pendingOrders(c.id).map((o) => [o.pluginId, Boolean(o.removal)]));
    const lines = gfPlugins.PLUGIN_IDS.map((id) => lineOf(c, id, { allowed, chosen, facts, writtenAt, erasing }));
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
      headerParts: headerParts(counts),
      counts,
      empty: chosen.size === 0 ? 'Aucun module actif.' : null,
      included,
      outOfPlan: lines.filter((l) => !l.switchable),
    };
  }

  // An order still on its way must not fire the next time the module is switched off — unless the space
  // already ran it: then the journal says so instead of « annulé » (audit 2026-10-28, L1).
  function cancelPendingOrders(c, pluginId, operator) {
    const facts = instances.readFacts(customersController.servedSlug(c));
    const ran = new Set(facts && facts.provisioning ? facts.provisioning.erasedOrders : []);
    customerPlugins.pendingOrders(c.id).filter((o) => o.pluginId === pluginId).forEach((o) => {
      customerPlugins.acknowledge(o.orderId, now().toISOString());
      const done = ran.has(o.orderId);
      const text = o.removal
        ? (done ? `${nameOf(pluginId)} déjà désinstallé` : `Désinstallation de ${nameOf(pluginId)} annulée`)
        : (done ? `Données de ${nameOf(pluginId)} déjà effacées` : `Effacement des données de ${nameOf(pluginId)} annulé`);
      customersController.journal(c.id, operator, 'module', text);
    });
  }

  // Rule 18 — a switch takes the linked modules along, each with its journal line, under one licence.
  function toggle(customerId, pluginId, on, operator, flags = {}) {
    const c = customersController.mustGet(customerId);
    if (typeof on !== 'boolean') throw httpError(400, 'INVALID', 'Module : allumé ou éteint.');
    if (!entryOf(pluginId)) throw httpError(404, 'UNKNOWN_PLUGIN', 'Module inconnu.');
    if (c.archivedAt) throw httpError(409, 'ARCHIVED', 'Client archivé : réactivez-le d’abord.');
    if (!c.pluginsSeededAt) throw httpError(409, 'NOT_SEEDED', unseededLabel(c));
    const allowed = allowedOf(c);
    if (!allowed.has(pluginId)) throw httpError(422, 'OUT_OF_PLAN', OUT_OF_PLAN);
    const chosen = new Set(customerPlugins.chosen(c.id).filter((id) => allowed.has(id)));
    if (chosen.has(pluginId) === on) return view(c.id);
    const refused = refusal(allowed, chosen, pluginId, on, flags);
    if (refused) throw refused;
    const moved = [...followers(allowed, chosen, pluginId, on), pluginId];
    moved.forEach((id) => {
      if (on) {
        customerPlugins.add(c.id, id, day(), operator);
        cancelPendingOrders(c, id, operator);
      } else {
        customerPlugins.remove(c.id, id);
      }
      customersController.journal(c.id, operator, 'module', `${nameOf(id)} ${on ? 'activé' : 'désactivé'}`);
    });
    customersController.issueLicence(c.id);
    return view(c.id);
  }

  // Rule 22 — the operator orders the erasure of an inactive module's data; the order travels in the
  // licence and the space runs it once (rule 23).
  function erase(customerId, pluginId, confirmSlug, operator) {
    const c = customersController.mustGet(customerId);
    if (!entryOf(pluginId)) throw httpError(404, 'UNKNOWN_PLUGIN', 'Module inconnu.');
    if (c.archivedAt) throw httpError(409, 'ARCHIVED', 'Client archivé : réactivez-le d’abord.');
    if (!c.pluginsSeededAt) throw httpError(409, 'NOT_SEEDED', unseededLabel(c));
    if (customerPlugins.chosen(c.id).includes(pluginId)) throw httpError(409, 'MODULE_ACTIVE', 'Module actif : à désactiver d’abord.');
    if (String(confirmSlug || '') !== c.slug) throw httpError(400, 'SLUG_MISMATCH', `Tapez exactement « ${c.slug} » pour confirmer.`);
    if (customerPlugins.pendingOrders(c.id).some((o) => o.pluginId === pluginId)) return view(c.id);
    const line = view(c.id).included.find((l) => l.id === pluginId);
    if (line && line.blockedBy) throw httpError(422, 'REQUIRED_BY', line.blockedBy);
    if (!line || !(line.canErase || line.canUninstall)) throw httpError(409, 'NOTHING_TO_ERASE', 'Rien à effacer : le module est encore actif sur l’espace, ou sans données.');
    customerPlugins.addOrder({ orderId: crypto.randomUUID(), customerId: c.id, pluginId, createdAt: now().toISOString(), operator, removal: line.canUninstall });
    customersController.journal(c.id, operator, 'module', line.canUninstall ? `Désinstallation de ${nameOf(pluginId)} demandée` : `Effacement des données de ${nameOf(pluginId)} demandé`);
    customersController.issueLicence(c.id);
    return view(c.id);
  }

  // Once the space reports an order executed, it leaves the licence (rule 23).
  function acknowledgeErasures() {
    let acknowledged = 0;
    customerPlugins.customersWithPendingOrders().forEach((customerId) => {
      const c = customers.get(customerId);
      const facts = c && !c.erasedAt ? instances.readFacts(customersController.servedSlug(c)) : null;
      if (!facts || !facts.provisioning) return;
      const done = customerPlugins.pendingOrders(customerId).filter((o) => facts.provisioning.erasedOrders.includes(o.orderId));
      done.forEach((o) => {
        customerPlugins.acknowledge(o.orderId, now().toISOString());
        customersController.journal(customerId, 'système', 'module', o.removal ? `${nameOf(o.pluginId)} désinstallé` : `Données de ${nameOf(o.pluginId)} effacées`);
        acknowledged += 1;
      });
      if (done.length) customersController.issueLicence(customerId);
    });
    return acknowledged;
  }

  // The console's minute tick: seeds what can now be read, and closes the orders the space ran.
  function sweep() {
    return { seeded: seedPending(), acknowledged: acknowledgeErasures() };
  }

  // « Réessayer » and « Relever maintenant »: a new licence is a new attempt (rule 18).
  function retry(customerId, operator) {
    const c = customersController.mustGet(customerId);
    if (!c.pluginsSeededAt && !seedCustomer(c, operator)) throw httpError(409, 'NOT_SEEDED', unseededLabel(c));
    customersController.issueLicence(c.id);
    return view(c.id);
  }

  // Rule 25 — from what the space runs now, before any licence carries `activePlugins`.
  function seedCustomer(c, operator = 'migration') {
    const facts = instances.readFacts(customersController.servedSlug(c));
    // Rule 29 — a space on a release before the reconciler would take the licence's choice for nothing.
    if (!facts || !facts.provisioning) return false;
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

  // A plan or option change: what is no longer allowed leaves the choice (edge case, rule 11), and so does
  // any chosen module left without a requirement (rule 19), with one journal line each.
  function dropNotAllowed(customerId, operator) {
    const c = customers.get(customerId);
    if (!c.pluginsSeededAt) return [];
    const allowed = allowedOf(c);
    const dropped = customerPlugins.chosen(c.id).filter((id) => !allowed.has(id));
    dropped.forEach((id) => {
      customerPlugins.remove(c.id, id);
      customersController.journal(c.id, operator, 'module', `${nameOf(id)} retiré (hors forfait)`);
    });
    // Only what lost its requirement in THIS change follows it: a choice that was already incoherent
    // keeps running, its line says « Nécessite … · éteint ».
    let left = customerPlugins.chosen(c.id);
    for (;;) {
      const orphan = left.find((id) => requiresOf(id).some((r) => dropped.includes(r)));
      if (!orphan) break;
      customerPlugins.remove(c.id, orphan);
      customersController.journal(c.id, operator, 'module', `${nameOf(orphan)} retiré (nécessite ${names(requiresOf(orphan).filter((r) => dropped.includes(r)))})`);
      dropped.push(orphan);
      left = left.filter((id) => id !== orphan);
    }
    return dropped;
  }

  return { view, toggle, retry, erase, sweep, acknowledgeErasures, seedCustomer, seedPending, licenceChoice, creationChoices, seedAtCreation, dropNotAllowed, refuseComposition };
}

module.exports = { createCustomerModulesController, compositionRefusal };
