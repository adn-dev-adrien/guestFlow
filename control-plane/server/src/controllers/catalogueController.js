/**
 * The plan catalogue editor (specs/control-plane-plans-and-access.md rules 1–6).
 *
 * The catalogue is stored as the lowest plan of each plugin; higher plans inherit it, so the plans
 * are nested by construction (rule 2). The editor works on a draft `lowest` map that the client
 * sends back: `toggle` applies one click of the matrix and refuses to break the nesting, `impact`
 * says whom a draft affects before saving (rule 5), `save` writes a new version (rule 6), keeps the
 * removed plugins for the customers who installed them (grandfathered, rule 5) and re-issues every
 * licence.
 */

const { plugins: gfPlugins } = require('../utils/gf');
const { httpError } = require('../utils/httpError');
const { euros } = require('../utils/money');
const { frDay } = require('../utils/days');

const pluginName = (id) => (gfPlugins.findPlugin(id) || { name: id }).name;
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

function createCatalogueController(ctx, customersController) {
  const { models, now, instances } = ctx;
  const { catalogue, customers, audit } = models;

  const stamp = () => now().toISOString();

  function planIndex(plans) {
    const byCode = new Map(plans.map((p) => [p.code, p]));
    return { byCode, rank: (code) => (code ? byCode.get(code).rank : null) };
  }

  function validateLowest(lowest, plans) {
    if (!lowest || typeof lowest !== 'object') throw httpError(400, 'INVALID', 'Catalogue illisible.');
    const codes = plans.map((p) => p.code);
    const out = {};
    for (const id of gfPlugins.PLUGIN_IDS) {
      const v = lowest[id] === undefined ? null : lowest[id];
      if (v !== null && !codes.includes(v)) throw httpError(400, 'INVALID', `Forfait inconnu pour ${pluginName(id)}.`);
      out[id] = v;
    }
    return out;
  }

  function matrix(lowest, plans) {
    const { byCode, rank } = planIndex(plans);
    return gfPlugins.PLUGIN_IDS.map((id) => ({
      pluginId: id,
      name: pluginName(id),
      cells: plans.map((p) => {
        const l = lowest[id];
        if (l === p.code) return { planCode: p.code, status: 'own', tooltip: 'Ajouté à partir de ce forfait' };
        if (l && rank(l) < p.rank) return { planCode: p.code, status: 'inherited', tooltip: `Inclus via ${byCode.get(l).name}` };
        return { planCode: p.code, status: 'none', tooltip: 'Non inclus' };
      }),
    }));
  }

  function view(lowest = catalogue.lowest()) {
    const plans = catalogue.plans();
    return {
      version: catalogue.currentVersion(),
      plans: plans.map((p) => ({
        ...p,
        priceLabel: `${euros(p.priceMonthlyCents)} / mois`,
        yearlyLabel: `${euros(p.priceYearlyCents)} / mois à l’année`,
      })),
      lowest: validateLowest(lowest, plans),
      matrix: matrix(lowest, plans),
      addons: catalogue.addons().map((a) => ({ ...a, name: pluginName(a.pluginId), priceLabel: `${euros(a.priceMonthlyCents)} HT / mois` })),
      addonChoices: gfPlugins.PLUGIN_IDS.map((id) => ({ pluginId: id, name: pluginName(id) })),
      versions: catalogue.versions().map((v) => ({ ...v, day: frDay(v.changedAt.slice(0, 10)) })),
    };
  }

  // One click in the matrix (rule 2).
  function toggle({ lowest: draft, pluginId, planCode }) {
    const plans = catalogue.plans();
    const lowest = validateLowest(draft, plans);
    const { byCode, rank } = planIndex(plans);
    if (!gfPlugins.PLUGIN_IDS.includes(pluginId) || !byCode.has(planCode)) throw httpError(400, 'INVALID', 'Case inconnue.');
    const name = pluginName(pluginId);
    const current = lowest[pluginId];
    const target = byCode.get(planCode);
    let message;
    if (current && rank(current) < target.rank) {
      throw httpError(409, 'NESTED', `Refusé : ${name} est inclus via ${byCode.get(current).name}. Les forfaits sont emboîtés : retirez-le d’abord du forfait ${byCode.get(current).name}.`);
    } else if (current === planCode) {
      const next = plans.find((p) => p.rank === target.rank + 1);
      lowest[pluginId] = next ? next.code : null;
      message = next
        ? `${name} retiré de ${target.name} ; il commence désormais en ${next.name}.`
        : `${name} retiré de tous les forfaits : il ne se vend plus qu’en option à la carte.`;
    } else {
      lowest[pluginId] = planCode;
      const higher = plans.some((p) => p.rank > target.rank);
      message = current
        ? `${name} descend en ${target.name}.`
        : `${name} ajouté à ${target.name}${higher ? ' et, par emboîtement, aux forfaits au-dessus' : ''}.`;
    }
    return { lowest, matrix: matrix(lowest, plans), message };
  }

  // Who gains and who keeps what, per plan (rule 5). Installed plugins are read from each instance.
  function analyse(lowest) {
    const plans = catalogue.plans();
    const current = catalogue.lowest();
    const { rank } = planIndex(plans);
    const live = customers.list().filter((c) => !c.archivedAt);
    const facts = new Map(live.map((c) => [c.id, instances.readFacts(c.slug)]));
    const lines = [];
    const grandfather = [];
    for (const id of gfPlugins.PLUGIN_IDS) {
      if ((current[id] || null) === (lowest[id] || null)) continue;
      for (const plan of plans) {
        const had = current[id] && rank(current[id]) <= plan.rank;
        const has = lowest[id] && rank(lowest[id]) <= plan.rank;
        const onPlan = live.filter((c) => c.planCode === plan.code);
        if (!had && has) {
          lines.push(`${plural(onPlan.length, 'client')} ${plan.name} ${onPlan.length > 1 ? 'gagnent' : 'gagne'} ${pluginName(id)} (disponible, pas installé d’office).`);
        } else if (had && !has) {
          const installed = onPlan.filter((c) => facts.get(c.id) && facts.get(c.id).installed.includes(id));
          const unknown = onPlan.filter((c) => !facts.get(c.id)).length;
          for (const c of installed) grandfather.push({ customerId: c.id, pluginId: id });
          lines.push(`${plural(installed.length, 'client')} ${plan.name} ${installed.length > 1 ? 'gardent' : 'garde'} ${pluginName(id)} déjà installé (hors forfait, conservé) ; les nouveaux clients ${plan.name} ne l’ont plus.${unknown ? ` ${plural(unknown, 'instance')} illisible${unknown > 1 ? 's' : ''} : non comptée${unknown > 1 ? 's' : ''}.` : ''}`);
        }
      }
    }
    return { lines, grandfather };
  }

  function impact({ lowest }) {
    return { lines: analyse(validateLowest(lowest, catalogue.plans())).lines };
  }

  function validatePlans(input, plans) {
    if (!Array.isArray(input)) return plans;
    return plans.map((p) => {
      const edit = input.find((x) => x.code === p.code) || {};
      const cents = (v, fallback) => (v === undefined ? fallback : v);
      const out = {
        code: p.code,
        priceMonthlyCents: cents(edit.priceMonthlyCents, p.priceMonthlyCents),
        priceYearlyCents: cents(edit.priceYearlyCents, p.priceYearlyCents),
        maxUnits: edit.maxUnits === undefined ? p.maxUnits : edit.maxUnits,
        maxUsers: edit.maxUsers === undefined ? p.maxUsers : edit.maxUsers,
      };
      for (const k of ['priceMonthlyCents', 'priceYearlyCents']) {
        if (!Number.isInteger(out[k]) || out[k] < 0) throw httpError(400, 'INVALID', `Prix invalide pour ${p.name}.`);
      }
      for (const k of ['maxUnits', 'maxUsers']) {
        if (out[k] !== null && (!Number.isInteger(out[k]) || out[k] < 1)) throw httpError(400, 'INVALID', `Quota invalide pour ${p.name} : un nombre entier, ou vide pour illimité.`);
      }
      return out;
    });
  }

  function validateAddons(input) {
    if (!Array.isArray(input)) return catalogue.addons();
    const seen = new Set();
    return input.map((a) => {
      if (!gfPlugins.PLUGIN_IDS.includes(a.pluginId) || seen.has(a.pluginId)) throw httpError(400, 'INVALID', 'Option inconnue ou en double.');
      if (!Number.isInteger(a.priceMonthlyCents) || a.priceMonthlyCents < 0) throw httpError(400, 'INVALID', `Prix invalide pour ${pluginName(a.pluginId)}.`);
      seen.add(a.pluginId);
      return { pluginId: a.pluginId, priceMonthlyCents: a.priceMonthlyCents };
    });
  }

  function save(body, operator) {
    const reason = String(body.reason || '').trim();
    if (!reason) throw httpError(400, 'REASON_REQUIRED', 'Le motif du changement est obligatoire.');
    const plansNow = catalogue.plans();
    const lowest = validateLowest(body.lowest || catalogue.lowest(), plansNow);
    const plans = validatePlans(body.plans, plansNow);
    const addons = validateAddons(body.addons);
    const { lines, grandfather } = analyse(lowest);
    const day = stamp().slice(0, 10);
    for (const g of grandfather) customers.addGrandfathered(g.customerId, g.pluginId, day);
    const version = catalogue.save({ plans, lowest, addons, changedBy: operator, reason, at: stamp() });
    audit.log({ at: stamp(), day, operator, customerId: null, kind: 'catalogue', text: `Catalogue v${version} : « ${reason} »` });
    for (const g of grandfather) {
      audit.log({ at: stamp(), day, operator, customerId: g.customerId, kind: 'catalogue', text: `${pluginName(g.pluginId)} conservé hors forfait (catalogue v${version})` });
    }
    customersController.reissueAll(operator);
    return { ...view(), impact: lines };
  }

  return { view, toggle, impact, save };
}

module.exports = { createCatalogueController };
