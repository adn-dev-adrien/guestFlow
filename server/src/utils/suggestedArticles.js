/**
 * suggestedArticles — the articles suggested for a sale context (the outside-visit spec rules 35-38). Generic: it knows nothing of baths, drinks, resources or stays.
 *
 * A **sale context** is `{ kind, id }`. The core declares `property` (the id is the property's); a plugin declares its own kinds with `ctx.suggestionContexts` (`hourly-resources`:
 * `resource`). A kind is known only while its plugin is live: with the plugin off the kind leaves the settings page and `resolve`, the stored rows stay.
 *
 *   kinds()                                  → [{ kind, label, contexts: [{ id, label }] }], every live kind and the contexts it lists now (a throwing provider is skipped)
 *   resolve({ context, customerContext, stay })  → [{ articleRef, label, unitCents, max }] in the operator's order, filtered by sellability for the caller (rule 36):
 *                                              `external`: `sellableExternally` and a family that needs no stay; `hosted`: the family's `validate` against the stay
 *                                              (`stay` = `{ persons, nights }`, one of each by default). An article gone from the catalogue is dropped silently. A pure read: the label
 *                                              and the unit price come from the Articles head's `quote` and `describe`, nothing is priced here.
 *   save(kind, id, articleRefs)              → `{ status: 200, articleRefs } | { status, body }`: at most 12 (400 `TOO_MANY`), each known to the catalogue (400 `ARTICLE_UNKNOWN`),
 *                                              no repeat (400 `ARTICLE_DUPLICATE`), the context listed by a live provider (404 `CONTEXT_UNKNOWN`)
 */
const registry = require('../plugins/sdk/registry');
const articles = require('./pricing/articles');
const { toCents } = require('./pricing/money');
const sales = require('../models/standaloneSalesModel');
const model = require('../models/suggestedArticlesModel');

const MAX_LISTED = 12;
const MAX_QUANTITY = 99;
// The families an external sale takes (rule 11): what needs a stay is never suggested for a customer with none.
const EXTERNAL_FAMILIES = Object.freeze(['fixed', 'perUnit']);
const NO_FREE_UNITS = Object.freeze({ grantedFreeUnitsFor: () => 0, consumedFreeUnitsFor: () => 0 });

const refuse = (status, code, error) => ({ status, body: { error, code } });

function coreKinds() {
  return [{
    kind: 'property',
    label: 'Logements',
    list: () => require('../models/propertiesModel').list().map((p) => ({ id: p.id, label: p.name })),
  }];
}

function providers() {
  const plugin = registry.all()
    .filter((r) => registry.isLive(r.id))
    .flatMap((r) => (r.suggestionContexts || []).map((c) => ({ kind: c.kind, label: c.label, list: c.list })));
  return [...coreKinds(), ...plugin];
}

function contextsOf(provider) {
  try {
    return (provider.list() || []).filter((c) => c && c.id != null).map((c) => ({ id: String(c.id), label: String(c.label || c.id) }));
  } catch {
    return [];
  }
}

function kinds() {
  return providers().map((provider) => ({ kind: provider.kind, label: provider.label, contexts: contextsOf(provider) }));
}

function resolve({ context, customerContext = 'hosted', stay = null } = {}) {
  if (!context || !providers().some((provider) => provider.kind === context.kind)) return [];
  const stayContext = { persons: Number(stay && stay.persons) || 1, nights: Number(stay && stay.nights) || 1, maxGuests: 0, isDirectBooking: true };
  const families = articles.liveFamilies();
  const out = [];
  for (const articleRef of model.listFor(context.kind, context.id)) {
    const found = sales.catalogueRow(articleRef);
    if (!found || found.row.archivedAt) continue;
    const article = articles.makeArticle(found.row, { kind: found.kind });
    if (customerContext === 'external' && (!article.config.sellableExternally || !EXTERNAL_FAMILIES.includes(article.family))) continue;
    const quoted = articles.quote({
      requests: [{ article, quantity: 1, portions: () => ({ quantity: 1, clampedFrom: null }) }],
      stayContext,
      customerContext: customerContext === 'external' ? 'external' : 'hosted',
      allowance: NO_FREE_UNITS,
      families,
    });
    if (quoted.refusals.length || !quoted.lines[0]) continue;
    out.push({
      articleRef,
      label: articles.describe(quoted.lines[0]).label,
      unitCents: toCents(quoted.lines[0].figures.unitPrice),
      max: MAX_QUANTITY,
    });
  }
  return out;
}

function save(kind, id, articleRefs) {
  const provider = providers().find((p) => p.kind === kind);
  if (!provider || !contextsOf(provider).some((c) => c.id === String(id))) return refuse(404, 'CONTEXT_UNKNOWN', 'Contexte inconnu.');
  if (!Array.isArray(articleRefs)) return refuse(400, 'INVALID_REQUEST', 'Liste d’articles attendue.');
  if (articleRefs.length > MAX_LISTED) return refuse(400, 'TOO_MANY', `${MAX_LISTED} articles au plus.`);
  const refs = articleRefs.map((ref) => String(ref));
  if (new Set(refs).size !== refs.length) return refuse(400, 'ARTICLE_DUPLICATE', 'Un article ne figure qu’une fois.');
  const unknown = refs.find((ref) => !sales.catalogueRow(ref));
  if (unknown) return refuse(400, 'ARTICLE_UNKNOWN', `Article inconnu : ${unknown}.`);
  return { status: 200, articleRefs: model.replace(kind, id, refs) };
}

/** The settings page payload: `{ kinds: [{ kind, label, contexts: [{ id, label, articleRefs }] }] }` (rule 37). */
function settingsView() {
  return { kinds: kinds().map((entry) => ({ ...entry, contexts: entry.contexts.map((c) => ({ ...c, articleRefs: model.listFor(entry.kind, c.id) })) })) };
}

module.exports = {
  kinds, resolve, save, settingsView, MAX_LISTED,
};
