/**
 * suggestedArticles — the articles suggested for a sale context (the outside-visit spec rules 35-38). Generic: it knows nothing of baths, drinks, resources or stays.
 *
 * A **sale context** is `{ kind, id }`. The core declares `property` (the id is the property's); a plugin declares its own kinds with `ctx.suggestionContexts` (`hourly-resources`:
 * `resource`). A kind is known only while its plugin is live: with the plugin off the kind leaves the settings page and `resolve`, the stored rows stay.
 *
 *   kinds()                                  → [{ kind, label, contexts: [{ id, label, shownOn }] }], every live kind and the contexts it lists now (a throwing provider is skipped);
 *                                              `shownOn` is `['arrival', 'site']` when the kind's provider says the website shows that context's list (`shownOnSite(id)`, site-outside-resource-booking
 *                                              rule 35), `['arrival']` otherwise (the core's `property` kind declares nothing)
 *   resolve({ context, customerContext, stay })  → [{ articleRef, label, unitCents, max }] in the operator's order, filtered by sellability for the caller (rule 36):
 *                                              `external`: `sellableExternally` and a family that needs no stay; `hosted`: the family's `validate` against the stay
 *                                              (`stay` = `{ persons, nights }`, one of each by default). An article gone from the catalogue is dropped silently. A pure read: the label
 *                                              and the unit price come from the Articles head's `quote` and `describe`, nothing is priced here.
 *   catalogue({ customerContext, q, all })   → [{ articleRef, label, unitCents, max, category }] every article the caller may sell, filtered by `q` (the « Autre article » search, the settings picker);
 *                                              `all`: the articles the caller may not sell are listed too, `sellable: false` with the `reason` and no price (the settings picker greys them, rule 36)
 *   catalogueGroups({ customerContext, q, all }) → [{ category, articles }] the same, grouped by category in that order (what the « Autre article » list renders)
 *   customerContextOf(kind)                  → `hosted` for the core's `property` kind, `external` for a plugin's (its customers have no stay), null for an unknown kind
 *   save(kind, id, articleRefs)              → `{ status: 200, articleRefs } | { status, body }`: at most 12 (400 `TOO_MANY`), each known to the catalogue (400 `ARTICLE_UNKNOWN`),
 *                                              no repeat (400 `ARTICLE_DUPLICATE`), the context listed by a live provider (404 `CONTEXT_UNKNOWN`); for an external kind an article the engine does not sell
 *                                              outside a stay is refused (400 `ARTICLE_NEEDS_STAY`, its reason + « Retirer pour enregistrer. », the `articleRef` in the body) — rule 36
 */
const registry = require('../plugins/sdk/registry');
const articles = require('./pricing/articles');
const { toCents } = require('./pricing/money');
const { unitLabelOf } = require('./addOnPricing');
const sales = require('../models/standaloneSalesModel');
const model = require('../models/suggestedArticlesModel');

const MAX_LISTED = 12;
const MAX_QUANTITY = 99;
const { NOT_SELLABLE_OUTSIDE } = articles;
const NOT_PRICED = 'Prix introuvable : l’article n’est pas proposé.';
const REMOVE_TO_SAVE = 'Retirer pour enregistrer.';
// What `outsideSale` does not sell at a counter (rule 11, pricing-components rule 124) is never suggested for a customer with none; null when the article sells.
const outsideRefusal = (article) => {
  if (!article.config.sellableExternally) return NOT_SELLABLE_OUTSIDE;
  const outside = articles.outsideSale(article);
  return outside.code === null ? null : outside.reason || NOT_SELLABLE_OUTSIDE;
};
const outsideOnly = (article) => outsideRefusal(article) !== null;
const NO_FREE_UNITS = Object.freeze({ grantedFreeUnitsFor: () => 0, consumedFreeUnitsFor: () => 0 });

const refuse = (status, code, error, extra = {}) => ({ status, body: { error, code, ...extra } });

function coreKinds() {
  return [{
    kind: 'property',
    label: 'Logements',
    list: () => require('../models/propertiesModel').list().map((p) => ({ id: p.id, label: p.name })),
    customerContext: 'hosted',
  }];
}

function providers() {
  const plugin = registry.all()
    .filter((r) => registry.isLive(r.id))
    .flatMap((r) => (r.suggestionContexts || []).map((c) => ({
      kind: c.kind, label: c.label, list: c.list, shownOnSite: c.shownOnSite, customerContext: 'external',
    })));
  return [...coreKinds(), ...plugin];
}

function shownOnSite(provider, id) {
  try {
    return typeof provider.shownOnSite === 'function' && provider.shownOnSite(id) === true;
  } catch {
    return false;
  }
}

function contextsOf(provider) {
  try {
    return (provider.list() || []).filter((c) => c && c.id != null).map((c) => ({
      id: String(c.id),
      label: String(c.label || c.id),
      shownOn: shownOnSite(provider, c.id) ? ['arrival', 'site'] : ['arrival'],
    }));
  } catch {
    return [];
  }
}

function hasContext(kind, id) {
  const provider = providers().find((p) => p.kind === kind);
  return Boolean(provider) && contextsOf(provider).some((c) => c.id === String(id));
}

function customerContextOf(kind) {
  const provider = providers().find((p) => p.kind === kind);
  return provider ? provider.customerContext : null;
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
    if (customerContext === 'external' && outsideOnly(article)) continue;
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

/**
 * The articles a caller may sell at all, for the « Autre article » search and the settings picker: every catalogue article of a family the caller can take (`external`:
 * `sellableExternally`, no stay needed), grouped by catalogue category, filtered by `q` (a fragment of the label, case-insensitive). Same filter and same pricing read as `resolve`.
 * `all` adds the refused ones with `sellable: false` and their `reason`, so the settings picker can show why they cannot be ticked (an unpriceable article stays out).
 * → [{ articleRef, label, unitCents, unitLabel, max, category, sellable?, reason? }]
 */
function catalogue({ customerContext = 'external', q = '', all = false } = {}) {
  const database = require('../database');
  const families = articles.liveFamilies();
  const wanted = String(q || '').trim().toLowerCase();
  const refs = [
    ...database.prepare('SELECT * FROM options').all().filter((row) => !row.archivedAt).map((row) => `option:${row.id}`),
    ...database.prepare('SELECT * FROM resources').all().filter((row) => !row.archivedAt).map((row) => `resource:${row.id}`),
  ];
  const out = [];
  for (const articleRef of refs) {
    const found = sales.catalogueRow(articleRef);
    if (!found) continue;
    const article = articles.makeArticle(found.row, { kind: found.kind });
    const category = String(found.row.category || '') || null;
    const refusal = customerContext === 'external' ? outsideRefusal(article) : null;
    if (refusal !== null) {
      const name = String(found.row.title || found.row.name || articleRef);
      if (all && (!wanted || name.toLowerCase().includes(wanted))) out.push({ articleRef, label: name, unitCents: null, unitLabel: unitLabelOf(article.config.priceType), max: MAX_QUANTITY, category, sellable: false, reason: refusal });
      continue;
    }
    const quoted = articles.quote({
      requests: [{ article, quantity: 1, portions: () => ({ quantity: 1, clampedFrom: null }) }],
      stayContext: { persons: 1, nights: 1, maxGuests: 0, isDirectBooking: true },
      customerContext: customerContext === 'external' ? 'external' : 'hosted',
      allowance: NO_FREE_UNITS,
      families,
    });
    if (quoted.refusals.length || !quoted.lines[0]) continue;
    const label = articles.describe(quoted.lines[0]).label;
    if (wanted && !label.toLowerCase().includes(wanted)) continue;
    out.push({
      articleRef, label, unitCents: toCents(quoted.lines[0].figures.unitPrice), unitLabel: unitLabelOf(article.config.priceType), max: MAX_QUANTITY, category, ...(all ? { sellable: true, reason: null } : {}),
    });
  }
  return out.sort((a, b) => String(a.category || '').localeCompare(String(b.category || ''), 'fr') || a.label.localeCompare(b.label, 'fr'));
}

/** The same answer grouped for display, in its order: `[{ category, articles }]` — the screen groups nothing itself (CLAUDE.md §7, end review R3-7). */
function catalogueGroups(args = {}) {
  const groups = [];
  for (const article of catalogue(args)) {
    const category = article.category || null;
    const last = groups[groups.length - 1];
    if (last && last.category === category) last.articles.push(article);
    else groups.push({ category, articles: [article] });
  }
  return groups;
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
  if (provider.customerContext === 'external') {
    for (const articleRef of refs) {
      const found = sales.catalogueRow(articleRef);
      const reason = found && !found.row.archivedAt ? outsideRefusal(articles.makeArticle(found.row, { kind: found.kind })) : null;
      if (reason !== null) return refuse(400, 'ARTICLE_NEEDS_STAY', `${reason} ${REMOVE_TO_SAVE}`, { articleRef });
    }
  }
  return { status: 200, articleRefs: model.replace(kind, id, refs) };
}

/**
 * The settings page payload: `{ kinds: [{ kind, label, contexts: [{ id, label, shownOn, articleRefs, articles: [{ articleRef, label, unitCents, unitLabel, reason }] }] }] }` (rules 37, 35-36).
 * `unitCents` is the price of one unit for the kind's customer and `unitLabel` what it is counted in; `reason` says why the article is refused there now, or that it cannot be priced (the read drops it
 * silently, so the screen must not) — null when it sells.
 */
function settingsView() {
  const nameOf = (articleRef) => {
    const found = sales.catalogueRow(articleRef);
    return found ? String(found.row.title || found.row.name || articleRef) : String(articleRef);
  };
  return {
    kinds: kinds().map((entry) => {
      const read = new Map(catalogue({ customerContext: customerContextOf(entry.kind) || 'external', all: true }).map((article) => [article.articleRef, article]));
      return {
        ...entry,
        contexts: entry.contexts.map((c) => {
          const articleRefs = model.listFor(entry.kind, c.id);
          return {
            ...c,
            articleRefs,
            articles: articleRefs.map((articleRef) => {
              const seen = read.get(articleRef);
              return {
                articleRef,
                label: nameOf(articleRef),
                unitCents: seen ? seen.unitCents : null,
                unitLabel: seen ? seen.unitLabel : null,
                reason: seen ? seen.reason : NOT_PRICED,
              };
            }),
          };
        }),
      };
    }),
  };
}

module.exports = {
  kinds, resolve, catalogue, catalogueGroups, save, settingsView, customerContextOf, hasContext, MAX_LISTED,
};
